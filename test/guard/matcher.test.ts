import { afterEach, describe, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { isIgnoredPath, loadMatcher } from "@guard/matcher.ts"

const roots: string[] = []

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencodeignore-"))
  roots.push(root)
  await fs.writeFile(
    path.join(root, ".agentignore"),
    ["dist/", "*.log", "*.tmp", "!important.log", "/secrets.txt", ""].join("\n"),
  )
  await fs.mkdir(path.join(root, "sub"), { recursive: true })
  await fs.writeFile(path.join(root, "sub", ".agentignore"), ["tmp/", "!keep.tmp", ""].join("\n"))
  return root
}

describe("matcher", () => {
  test("applies directory, glob, rooted, and negation rules", async () => {
    const root = await fixture()
    const matcher = await loadMatcher(root, { respectGitignore: false, baseFile: null })
    const check = (value: string): boolean => isIgnoredPath(root, matcher, value)
    expect(check("dist/bundle.js")).toBe(true)
    expect(check("dist")).toBe(true)
    expect(check("a.log")).toBe(true)
    expect(check("important.log")).toBe(false)
    expect(check("secrets.txt")).toBe(true)
    expect(check("sub/secrets.txt")).toBe(false)
    expect(check("src/index.ts")).toBe(false)
  })

  test("lets deeper files override shallower ones", async () => {
    const root = await fixture()
    const matcher = await loadMatcher(root, { respectGitignore: false, baseFile: null })
    const check = (value: string): boolean => isIgnoredPath(root, matcher, value)
    expect(check("sub/other.tmp")).toBe(true)
    expect(check("sub/keep.tmp")).toBe(false)
    expect(check("sub/tmp/x")).toBe(true)
  })

  test("ignores absolute paths outside the root", async () => {
    const root = await fixture()
    const matcher = await loadMatcher(root, { respectGitignore: false, baseFile: null })
    const outside = path.resolve(root, "..", "other.log")
    expect(isIgnoredPath(root, matcher, outside)).toBe(false)
    expect(isIgnoredPath(root, matcher, path.join(root, "dist", "x.js"))).toBe(true)
  })

  test("dedupes repeated patterns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencodeignore-"))
    roots.push(root)
    await fs.writeFile(path.join(root, ".agentignore"), ["*.log", "*.log", ""].join("\n"))
    const matcher = await loadMatcher(root, { respectGitignore: false, baseFile: null })
    expect(matcher.rules).toEqual(["*.log"])
    expect(isIgnoredPath(root, matcher, "a.log")).toBe(true)
  })

  test("merges a global base file under local rules", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencodeignore-"))
    roots.push(root)
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencodeignore-base-"))
    roots.push(baseDir)
    const base = path.join(baseDir, ".agentignore")
    await fs.writeFile(base, ["*.log", "dist/", ""].join("\n"))
    await fs.writeFile(path.join(root, ".agentignore"), ["*.log", "!keep.log", ""].join("\n"))
    const matcher = await loadMatcher(root, { respectGitignore: false, baseFile: base })
    expect(matcher.rules).toEqual(["*.log", "dist/", "!keep.log"])
    expect(matcher.files).toContain(base)
    const check = (value: string): boolean => isIgnoredPath(root, matcher, value)
    expect(check("a.log")).toBe(true)
    expect(check("keep.log")).toBe(false)
    expect(check("dist/b.js")).toBe(true)
  })

  test("skips a missing base file", async () => {
    const root = await fixture()
    const missing = path.join(root, "nope.agentignore")
    const matcher = await loadMatcher(root, { respectGitignore: false, baseFile: missing })
    expect(matcher.files).not.toContain(missing)
  })
})
