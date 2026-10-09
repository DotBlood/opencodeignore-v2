import path from "node:path"
import { promises as fs } from "node:fs"
import { Plugin, Skill } from "@opencode/plugin/effect"
import { Effect, Schedule, Stream } from "effect"
import { parseOptions, type OpencodeignoreOptions } from "@options/config.js"
import {
  emptyMatcher,
  isIgnoredPath,
  loadMatcher,
  type LoadedMatcher,
  type MatcherSources,
} from "@guard/matcher.js"
import { decideForResources } from "@guard/decide.js"
import { filterResultPaths, stripPromptFiles } from "@guard/result-filter.js"
import { buildPolicyText } from "@skill/policy-text.js"
import { OpencodeignoreRpc } from "@rpc"
import type { IgnoreAction } from "@commands/definition.js"
import { createActionRunner, defaultEntryLookup } from "@commands/actions.js"
import {
  findPluginEntry,
  globalBaseFile,
  isInsideDir,
  ownPackageName,
  pluginRootDir,
  readEntryOptions,
} from "@options/config-file.js"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function resolveRoot(location: unknown): string {
  if (isRecord(location)) {
    const project = location.project
    if (isRecord(project)) {
      if (typeof project.canonical === "string" && project.canonical.length > 0) return project.canonical
      if (typeof project.directory === "string" && project.directory.length > 0) return project.directory
    }
    if (typeof location.directory === "string" && location.directory.length > 0) return location.directory
  }
  return process.cwd()
}

async function snapshotMtimes(files: string[]): Promise<string> {
  const parts: string[] = []
  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      parts.push(`${file}:${stat.mtimeMs}`)
    } catch {
      // A missing file changes the signature, which triggers a rebuild.
      parts.push(`${file}:missing`)
    }
  }
  return parts.join("|")
}

interface LoadOutcome {
  matcher: LoadedMatcher
  failed: unknown
  hasFailed: boolean
}

function loadOutcome(root: string, sources: MatcherSources): Promise<LoadOutcome> {
  return loadMatcher(root, sources).then(
    (matcher): LoadOutcome => ({ matcher, failed: undefined, hasFailed: false }),
    (failed: unknown): LoadOutcome => ({ matcher: emptyMatcher(root), failed, hasFailed: true }),
  )
}

export default Plugin.define({
  id: "opencodeignore",
  effect: (ctx) =>
    Effect.gen(function* () {
      const options = parseOptions(ctx.options)
      const root = resolveRoot(ctx.location)
      const globalMode = !isInsideDir(pluginRootDir(), root)
      const baseFile = globalMode ? globalBaseFile() : null
      const sources = (): MatcherSources => ({
        respectGitignore: state.options.respectGitignore,
        baseFile,
      })
      const candidate = path.join(root, ".agentignore")
      const watched = (files: string[]): string[] => [...new Set([...files, candidate])]

      const loaded = yield* Effect.promise(() => loadOutcome(root, { respectGitignore: options.respectGitignore, baseFile }))
      if (loaded.hasFailed) {
        yield* Effect.logWarning("opencodeignore failed to load rules, starting empty", loaded.failed)
      }
      const state: {
        options: OpencodeignoreOptions
        matcher: LoadedMatcher
        snapshot: string
        configFile: string | null
      } = {
        options,
        matcher: loaded.matcher,
        snapshot: yield* Effect.promise(() => snapshotMtimes(watched(loaded.matcher.files))),
        configFile: null,
      }
      const testPath = (value: string): boolean => isIgnoredPath(root, state.matcher, value)

      const refreshOptionsFromFile = Effect.gen(function* () {
        const rootDir = pluginRootDir()
        const found = yield* Effect.promise(() =>
          ownPackageName(rootDir).then((ownName) => findPluginEntry(root, rootDir, ownName)),
        )
        if (found === null) {
          state.configFile = null
          return
        }
        state.configFile = `${found.file} [#${found.index}]`
        state.options = parseOptions(readEntryOptions(found.raw))
      })
      yield* refreshOptionsFromFile

      const runCommand = createActionRunner({
        root,
        globalMode,
        getState: () => state,
        setOptions: (next) => {
          state.options = next
        },
        setConfigFile: (value) => {
          state.configFile = value
        },
        fileExists: async (file) => {
          try {
            await fs.stat(file)
            return true
          } catch {
            return false
          }
        },
        writeFile: (file, content) => fs.writeFile(file, content, "utf8"),
        ...defaultEntryLookup(root),
      })

      yield* ctx.permission.hook("evaluate", (event) =>
        Effect.sync(() => {
          if (!state.options.enabled) return
          const decision = decideForResources(
            event.action,
            event.resources,
            testPath,
            state.options,
            state.matcher.rules.length > 0,
          )
          if (decision.effect !== "allow") {
            event.effect = decision.effect
            event.message = decision.message
          }
        }),
      )

      yield* ctx.tool.hook("execute.after", (event) =>
        Effect.gen(function* () {
          if (!state.options.enabled) return
          if (event.tool !== "glob" && event.tool !== "grep") return
          if (event.status !== "completed") return
          const filtered = filterResultPaths(event.result, testPath)
          if (filtered.removed === 0) return
          event.result = filtered.value
          yield* Effect.logInfo("opencodeignore removed paths from tool results", {
            tool: event.tool,
            removed: filtered.removed,
          })
        }),
      )

      yield* ctx.session.hook("prompt", (event) =>
        Effect.gen(function* () {
          if (!state.options.enabled) return
          const stripped = stripPromptFiles(event.prompt.files as unknown, testPath)
          if (stripped.removed === 0) return
          event.prompt.files = stripped.value as typeof event.prompt.files
          yield* Effect.logInfo("opencodeignore removed attachments from prompt", {
            removed: stripped.removed,
          })
        }),
      )

      const runAction = (action: IgnoreAction) =>
        Effect.gen(function* () {
          const outcome = yield* Effect.promise(() => runCommand(action))
          if (outcome.refreshRules) yield* rebuild
          else if (outcome.refreshOptions) {
            yield* refreshOptionsFromFile
            if (state.options.skill.enabled) yield* ctx.skill.reload()
          }
          return outcome.note
        })

      const reportAction = (action: IgnoreAction) => (input: { sessionID: string }) =>
        Effect.gen(function* () {
          const note = yield* runAction(action)
          yield* ctx.session.synthetic({
            // SessionID is a compile time brand; the runtime value is a plain string.
            sessionID: input.sessionID as never,
            text: note,
            resume: false,
          })
          yield* Effect.void
        })

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "ignore-init",
          description: "Create the project .agentignore with starter templates.",
          execute: reportAction("init"),
        })
        editor.add({
          name: "ignore-on",
          description: "Enable the .agentignore guard.",
          execute: reportAction("on"),
        })
        editor.add({
          name: "ignore-off",
          description: "Disable the .agentignore guard.",
          execute: reportAction("off"),
        })
        editor.add({
          name: "ignore-switch",
          description: "Flip the .agentignore effect between ask and deny.",
          execute: reportAction("switch"),
        })
        editor.add({
          name: "ignore-status",
          description: "Show the .agentignore guard state.",
          execute: reportAction("status"),
        })
      })

      if (state.options.skill.enabled) {
        yield* ctx.skill.transform((editor) => {
          editor.add(
            Skill.Info.make({
              id: Skill.ID.make("opencodeignore"),
              name: Skill.Name.make("Opencodeignore"),
              description:
                "Policy for paths guarded by .agentignore. Load it before reading, editing, or searching guarded files.",
              // The brand is compile time only; the runtime value stays a plain string.
              path: candidate as never,
              content: state.options.enabled
                ? buildPolicyText(state.matcher.rules, state.options.skill.compactLimit)
                : "The .agentignore guard is currently off. Nothing is blocked.",
            }),
          )
        })
        yield* ctx.session.hook("context", (event) =>
          Effect.sync(() => {
            if (!state.options.enabled) return
            event.system.push({
              type: "text",
              text: buildPolicyText(state.matcher.rules, Math.min(state.options.skill.compactLimit, 800)),
            })
          }),
        )
      }

      const rpc = yield* ctx.rpc.register(OpencodeignoreRpc, {
        isIgnored: (input) => {
          const checked = isRecord(input) && typeof input.path === "string" ? input.path : ""
          return Effect.succeed({ ignored: checked === "" ? false : testPath(checked) })
        },
        listRules: () => Effect.succeed({ root, rules: state.matcher.rules }),
      })

      const rebuild = Effect.gen(function* () {
        const outcome = yield* Effect.promise(() => loadOutcome(root, sources()))
        if (outcome.hasFailed) {
          yield* Effect.logWarning("opencodeignore reload failed, keeping previous rules", outcome.failed)
          return
        }
        state.matcher = outcome.matcher
        state.snapshot = yield* Effect.promise(() => snapshotMtimes(watched(outcome.matcher.files)))
        if (state.options.skill.enabled) yield* ctx.skill.reload()
        yield* rpc.events.emit("updated", { count: outcome.matcher.rules.length })
      })

      const rebuildAll = Effect.gen(function* () {
        yield* refreshOptionsFromFile
        yield* rebuild
      })

      yield* ctx.event.subscribe().pipe(
        Stream.filter((item) => item.type === "config.updated"),
        Stream.runForEach(() => rebuildAll),
        Effect.forkScoped,
      )

      const watch = Effect.gen(function* () {
        const signature = yield* Effect.promise(() => snapshotMtimes(watched(state.matcher.files)))
        if (signature !== state.snapshot) yield* rebuild
      })
      yield* Effect.repeat(watch, { schedule: Schedule.spaced("10 seconds") }).pipe(Effect.forkScoped)

      yield* Effect.logInfo("opencodeignore ready", {
        root,
        globalMode,
        rules: state.matcher.rules.length,
      })
    }).pipe(Effect.orDie),
})
