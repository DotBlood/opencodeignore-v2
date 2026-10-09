import { afterEach, describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { parseOptions } from "@options/config.ts"
import { emptyMatcher } from "@guard/matcher.ts"
import { AGENTIGNORE_TEMPLATE } from "@commands/definition.ts"
import { createActionRunner, type ActionDeps, type ActionState } from "@commands/actions.ts"
import { writeEntryOptions, type PluginEntryLocation } from "@options/config-file.ts"

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await fs.rm(root, { recursive: true, force: true })
  }
})

async function setup(): Promise<{ root: string; holder: { state: ActionState }; deps: ActionDeps }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ignoreact-"))
  roots.push(root)
  const holder = {
    state: { options: parseOptions({}), matcher: emptyMatcher(root), configFile: null } as ActionState,
  }
  const deps: ActionDeps = {
    root,
    globalMode: false,
    getState: () => holder.state,
    setOptions: (options) => {
      holder.state.options = options
    },
    setConfigFile: (value) => {
      holder.state.configFile = value
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
    findEntry: async (): Promise<PluginEntryLocation | null> => {
      const file = path.join(root, "opencode.jsonc")
      try {
        const doc = parse(await fs.readFile(file, "utf8")) as { plugins: unknown[] }
        const raw = doc.plugins[0]
        return { file, index: 0, raw }
      } catch {
        return null
      }
    },
    saveOptions: (location, patch) => writeEntryOptions(location, patch),
  }
  return { root, holder, deps }
}

describe("actions", () => {
  test("init creates the template once", async () => {
    const { root, deps } = await setup()
    const target = path.join(root, ".agentignore")
    const first = await createActionRunner(deps)("init")
    expect(first.note).toContain("Created")
    expect(first.refreshRules).toBe(true)
    expect(await fs.readFile(target, "utf8")).toBe(AGENTIGNORE_TEMPLATE)
    const second = await createActionRunner(deps)("init")
    expect(second.note).toContain("already exists")
    expect(second.refreshRules).toBe(false)
  })

  test("on, off, and switch rewrite the config entry", async () => {
    const { root, holder, deps } = await setup()
    const file = path.join(root, "opencode.jsonc")
    await fs.writeFile(file, '{ "plugins": [{ "package": "./", "options": {} }] }\n')
    const run = createActionRunner(deps)

    const off = await run("off")
    expect(off.note).toContain("disabled")
    expect(off.refreshOptions).toBe(true)
    expect(holder.state.options.enabled).toBe(false)

    const on = await run("on")
    expect(holder.state.options.enabled).toBe(true)

    const switched = await run("switch")
    expect(switched.note).toContain("ask")
    expect(holder.state.options.effect).toBe("ask")
    const doc = parse(await fs.readFile(file, "utf8")) as { plugins: { options: unknown }[] }
    expect(doc.plugins[0]?.options).toEqual({ enabled: true, effect: "ask" })
  })

  test("status reports scope and usage", async () => {
    const { deps } = await setup()
    const note = (await createActionRunner(deps)("status")).note
    expect(note).toContain("scope: local")
    expect(note).toContain("/ignore-init")
  })

  test("missing config entry becomes a failed note", async () => {
    const { deps } = await setup()
    const note = (await createActionRunner(deps)("switch")).note
    expect(note).toContain("Ignore command failed")
  })
})
