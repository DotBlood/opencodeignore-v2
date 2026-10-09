import path from "node:path"
import { parseOptions, type OpencodeignoreOptions } from "@options/config.js"
import type { LoadedMatcher } from "@guard/matcher.js"
import { AGENTIGNORE_TEMPLATE, ignoreUsage, toggleEffect, type IgnoreAction } from "./definition.js"
import type { PluginEntryLocation } from "@options/config-file.js"
import { findPluginEntry, ownPackageName, pluginRootDir, writeEntryOptions } from "@options/config-file.js"

export interface ActionState {
  options: OpencodeignoreOptions
  matcher: LoadedMatcher
  configFile: string | null
}

export interface ActionDeps {
  root: string
  globalMode: boolean
  getState: () => ActionState
  setOptions: (options: OpencodeignoreOptions) => void
  setConfigFile: (value: string | null) => void
  fileExists: (file: string) => Promise<boolean>
  writeFile: (file: string, content: string) => Promise<void>
  findEntry: () => Promise<PluginEntryLocation | null>
  saveOptions: (
    location: PluginEntryLocation,
    patch: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
}

export interface ActionOutcome {
  note: string
  refreshRules: boolean
  refreshOptions: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function statusNote(root: string, globalMode: boolean, state: ActionState): string {
  return [
    `.agentignore guard: ${state.options.enabled ? "on" : "off"}`,
    `effect: ${state.options.effect}`,
    `scope: ${globalMode ? "global (base + local)" : "local"}`,
    `root: ${root}`,
    `rules: ${state.matcher.rules.length} (${state.matcher.files.length} files)`,
    `config: ${state.configFile ?? "entry not found; using startup options"}`,
    ignoreUsage(),
  ].join("\n")
}

async function patchConfig(deps: ActionDeps, patch: Record<string, unknown>): Promise<void> {
  const found = await deps.findEntry()
  if (found === null) {
    throw new Error("plugin entry not found in any opencode.json(c); edit options manually")
  }
  const next = await deps.saveOptions(found, patch)
  deps.setOptions(parseOptions(next))
  deps.setConfigFile(`${found.file} [#${found.index}]`)
}

export function defaultEntryLookup(
  root: string,
): Pick<ActionDeps, "findEntry" | "saveOptions"> {
  return {
    findEntry: async () => {
      const rootDir = pluginRootDir()
      return findPluginEntry(root, rootDir, await ownPackageName(rootDir))
    },
    saveOptions: (location, patch) => writeEntryOptions(location, patch),
  }
}

export function createActionRunner(deps: ActionDeps): (action: IgnoreAction) => Promise<ActionOutcome> {
  return async (action) => {
    const done = (note: string, refreshRules = false, refreshOptions = false): ActionOutcome => ({
      note,
      refreshRules,
      refreshOptions,
    })
    const state = deps.getState()
    try {
      switch (action) {
        case "init": {
          const target = path.join(deps.root, ".agentignore")
          if (await deps.fileExists(target)) {
            return done(
              `.agentignore already exists (${state.matcher.rules.length} rules). No changes made.\n\n${ignoreUsage()}`,
            )
          }
          await deps.writeFile(target, AGENTIGNORE_TEMPLATE)
          return done(`Created ${target} with starter templates.`, true)
        }
        case "on":
        case "off": {
          await patchConfig(deps, { enabled: action === "on" })
          return done(`.agentignore guard ${action === "on" ? "enabled" : "disabled"}.`, false, true)
        }
        case "switch": {
          const next = toggleEffect(state.options.effect)
          await patchConfig(deps, { effect: next })
          return done(`.agentignore effect: ${next}.`, false, true)
        }
        default:
          return done(statusNote(deps.root, deps.globalMode, deps.getState()))
      }
    } catch (error) {
      return done(`Ignore command failed: ${messageOf(error)}`)
    }
  }
}
