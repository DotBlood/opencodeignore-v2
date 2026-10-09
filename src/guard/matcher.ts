import { promises as fs } from "node:fs"
import path from "node:path"
import ignore from "ignore"

type IgnoreInstance = ReturnType<typeof ignore>

interface Level {
  baseRel: string
  inst: IgnoreInstance
}

export interface LoadedMatcher {
  root: string
  levels: Level[]
  rules: string[]
  files: string[]
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", ".jj"])

function depth(rel: string): number {
  return rel === "" ? 0 : rel.split("/").length
}

async function collectIgnoreFiles(
  root: string,
  respectGitignore: boolean,
): Promise<{ abs: string; rel: string }[]> {
  const names = respectGitignore ? [".agentignore", ".gitignore"] : [".agentignore"]
  const found: { abs: string; rel: string }[] = []
  async function walk(dir: string, rel: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // Unreadable directories contribute no rules.
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(path.join(dir, entry.name), rel === "" ? entry.name : `${rel}/${entry.name}`)
      } else if (entry.isFile() && names.includes(entry.name)) {
        found.push({ abs: path.join(dir, entry.name), rel })
      }
    }
  }
  await walk(root, "")
  found.sort((a, b) => depth(a.rel) - depth(b.rel) || (a.abs < b.abs ? -1 : 1))
  return found
}

export function emptyMatcher(root: string): LoadedMatcher {
  return { root, levels: [], rules: [], files: [] }
}

export interface MatcherSources {
  respectGitignore: boolean
  baseFile: string | null
}

function splitPatterns(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

export async function loadMatcher(root: string, sources: MatcherSources): Promise<LoadedMatcher> {
  const files = await collectIgnoreFiles(root, sources.respectGitignore)
  const levels: Level[] = []
  const rules: string[] = []
  const seen = new Set<string>()
  const pushFile = (abs: string, rel: string, raw: string): void => {
    const fresh = splitPatterns(raw).filter((pattern) => {
      const key = `${rel}\n${pattern}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (fresh.length === 0) return
    const inst = ignore()
    inst.add(fresh)
    levels.push({ baseRel: rel, inst })
    for (const pattern of fresh) {
      rules.push(rel === "" ? pattern : `${rel}: ${pattern}`)
    }
  }
  const existing: string[] = []
  if (sources.baseFile !== null) {
    const raw = await fs.readFile(sources.baseFile, "utf8").catch(() => null)
    if (raw !== null) {
      pushFile(sources.baseFile, "", raw)
      existing.push(sources.baseFile)
    }
  }
  for (const file of files) {
    const raw = await fs.readFile(file.abs, "utf8").catch(() => "")
    pushFile(file.abs, file.rel, raw)
    existing.push(file.abs)
  }
  return { root, levels, rules, files: existing }
}

function scopeToBase(rel: string, base: string): string | null {
  if (base === "") return rel
  if (rel === base) return null
  if (rel.startsWith(`${base}/`)) return rel.slice(base.length + 1)
  return null
}

export function testRelative(matcher: LoadedMatcher, relPosix: string): boolean {
  const rel = relPosix.replace(/^\.\//, "")
  if (rel === "" || rel === ".") return false
  let ignored = false
  for (const level of matcher.levels) {
    const scoped = scopeToBase(rel, level.baseRel)
    if (scoped === null || scoped === "") continue
    const result = level.inst.test(scoped)
    if (result.ignored) ignored = true
    else if (result.unignored) ignored = false
  }
  return ignored
}

export function toProjectRelative(root: string, value: string): string | null {
  const unified = value.replace(/\\/g, "/")
  let rel: string
  if (unified.startsWith("/") || /^[A-Za-z]:\//.test(unified)) {
    const computed = path.relative(root, value)
    if (computed === "") return ""
    if (computed.startsWith("..") || path.isAbsolute(computed)) return null
    rel = computed.replace(/\\/g, "/")
  } else {
    rel = unified.replace(/^\.\//, "")
  }
  return rel
}

export function isIgnoredPath(root: string, matcher: LoadedMatcher, value: string): boolean {
  const rel = toProjectRelative(root, value)
  if (rel === null || rel === "") return false
  if (testRelative(matcher, rel)) return true
  // The matcher cannot tell files from directories without a stat, so probe both readings.
  return testRelative(matcher, `${rel}/`)
}
