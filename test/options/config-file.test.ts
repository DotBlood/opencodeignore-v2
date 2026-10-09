import { afterEach, describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import {
  findPluginEntry,
  globalBaseFile,
  readEntryOptions,
  writeEntryOptions,
} from "@options/config-file.ts"

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await fs.rm(root, { recursive: true, force: true })
  }
})

async function tmpRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ignorecfg-"))
  roots.push(root)
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "x-test" }))
  return root
}

describe("config file lookup", () => {
  test("finds an object entry and preserves comments on write", async () => {
    const root = await tmpRoot()
    const file = path.join(root, "opencode.jsonc")
    await fs.writeFile(
      file,
      '{\n  // guard settings\n  "plugins": [\n    { "package": "./", "options": { "effect": "ask" } }\n  ]\n}\n',
    )
    const found = await findPluginEntry(root, root, "x-test")
    expect(found?.index).toBe(0)
    expect(readEntryOptions(found?.raw)).toEqual({ effect: "ask" })
    const next = await writeEntryOptions(found!, { enabled: false })
    expect(next).toEqual({ effect: "ask", enabled: false })
    const text = await fs.readFile(file, "utf8")
    expect(text).toContain("// guard settings")
    const doc = parse(text) as { plugins: { options: unknown }[] }
    expect(doc.plugins[0]?.options).toEqual({ effect: "ask", enabled: false })
  })

  test("upgrades a string entry to an object entry", async () => {
    const root = await tmpRoot()
    const file = path.join(root, "opencode.jsonc")
    await fs.writeFile(file, '{ "plugins": ["./"] }\n')
    const found = await findPluginEntry(root, root, "x-test")
    expect(found?.index).toBe(0)
    await writeEntryOptions(found!, { effect: "deny" })
    const doc = parse(await fs.readFile(file, "utf8")) as {
      plugins: { package: string; options: unknown }[]
    }
    expect(doc.plugins[0]?.package).toBe("./")
    expect(doc.plugins[0]?.options).toEqual({ effect: "deny" })
  })

  test("returns null when nothing references the plugin", async () => {
    const root = await tmpRoot()
    await fs.writeFile(path.join(root, "opencode.jsonc"), '{ "plugins": ["other-pkg"] }\n')
    expect(await findPluginEntry(root, root, "x-test")).toBeNull()
  })
})

describe("global base file", () => {
  test("sits next to the global config", () => {
    expect(globalBaseFile().endsWith(".agentignore")).toBe(true)
    expect(globalBaseFile()).toContain("opencode")
  })
})
