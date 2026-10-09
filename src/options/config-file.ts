import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse } from "jsonc-parser"

export interface PluginEntryLocation {
  file: string
  index: number
  raw: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function pluginRootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

export async function ownPackageName(root: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8")
    const data: unknown = JSON.parse(raw)
    if (isRecord(data) && typeof data.name === "string") return data.name
  } catch {
    // Missing metadata means registry entries cannot be matched by name.
  }
  return null
}

export function globalConfigDir(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
}

export function globalBaseFile(): string {
  return path.join(globalConfigDir(), "opencode", ".agentignore")
}

export function isInsideDir(child: string, parent: string): boolean {
  const norm = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value)
  const rel = path.relative(norm(parent), norm(child))
  return rel !== "" && !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`)
}

function candidateConfigs(projectRoot: string): string[] {
  const base = globalConfigDir()
  return [
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, ".opencode", "opencode.jsonc"),
    path.join(projectRoot, ".opencode", "opencode.json"),
    path.join(base, "opencode", "opencode.jsonc"),
    path.join(base, "opencode", "opencode.json"),
  ]
}

function registryNameOf(entry: string): string | null {
  if (entry.includes("://") || entry.startsWith("git+") || entry.startsWith("github:")) return null
  const scoped = entry.startsWith("@")
  const match = scoped
    ? /^(@[^@/]+\/[^@/]+)(?:@.+)?$/.exec(entry)
    : /^([^@/]+)(?:@.+)?$/.exec(entry)
  return match?.[1] ?? null
}

function isPathEntry(entry: string): boolean {
  return (
    entry.startsWith(".") ||
    entry.startsWith("/") ||
    entry.startsWith("file:") ||
    /^[A-Za-z]:[\\/]/.test(entry)
  )
}

async function samePath(left: string, right: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([fs.realpath(left), fs.realpath(right)])
    return process.platform === "win32"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b
  } catch {
    return false
  }
}

async function matchesPlugin(
  spec: string,
  configDir: string,
  root: string,
  ownName: string | null,
): Promise<boolean> {
  if (isPathEntry(spec)) {
    const stripped = spec.startsWith("file://") ? decodeURIComponent(spec.slice("file://".length)) : spec
    return samePath(path.resolve(configDir, stripped), root)
  }
  if (ownName === null) return false
  return registryNameOf(spec) === ownName
}

export async function findPluginEntry(
  projectRoot: string,
  root: string,
  ownName: string | null,
): Promise<PluginEntryLocation | null> {
  for (const file of candidateConfigs(projectRoot)) {
    let text: string
    try {
      text = await fs.readFile(file, "utf8")
    } catch {
      continue
    }
    let doc: unknown
    try {
      doc = parse(text)
    } catch {
      continue
    }
    if (!isRecord(doc) || !Array.isArray(doc.plugins)) continue
    for (let index = 0; index < doc.plugins.length; index += 1) {
      const raw: unknown = doc.plugins[index]
      const spec =
        typeof raw === "string" ? raw : isRecord(raw) && typeof raw.package === "string" ? raw.package : null
      if (spec === null) continue
      if (await matchesPlugin(spec, path.dirname(file), root, ownName)) return { file, index, raw }
    }
  }
  return null
}

export function readEntryOptions(raw: unknown): Record<string, unknown> {
  if (isRecord(raw) && isRecord(raw.options)) return { ...raw.options }
  return {}
}

export async function writeEntryOptions(
  location: PluginEntryLocation,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const text = await fs.readFile(location.file, "utf8")
  const next = { ...readEntryOptions(location.raw), ...patch }
  const value =
    typeof location.raw === "string" ? { package: location.raw, options: next } : next
  const target = typeof location.raw === "string" ? ["plugins", location.index] : ["plugins", location.index, "options"]
  const edits = modify(text, target, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
  await fs.writeFile(location.file, applyEdits(text, edits), "utf8")
  return next
}
