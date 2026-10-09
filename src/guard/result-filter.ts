const PATH_KEYS = new Set(["path", "file", "filename", "filepath", "uri"])
const PATH_LIST_KEYS = new Set(["content", "files", "matches", "results", "items", "paths"])

const DROP: unique symbol = Symbol("drop")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function uriToPath(value: string): string | null {
  if (!value.startsWith("file://")) return value
  try {
    let rest = decodeURIComponent(value.slice("file://".length))
    if (/^\/[A-Za-z]:\//.test(rest)) rest = rest.slice(1)
    return rest
  } catch {
    return null
  }
}

function pathFieldOf(record: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const candidate = record[key]
    if (typeof candidate === "string") return candidate
  }
  return null
}

function clean(
  value: unknown,
  testPath: (candidate: string) => boolean,
  inPathList: boolean,
  counter: { removed: number },
): unknown | typeof DROP {
  if (typeof value === "string") {
    // Bare strings count only inside path lists; prose is never filtered.
    if (!inPathList || /\s/.test(value)) return value
    const candidate = uriToPath(value)
    if (candidate === null || !testPath(candidate)) return value
    counter.removed += 1
    return DROP
  }
  if (Array.isArray(value)) {
    const kept: unknown[] = []
    for (const item of value) {
      const cleaned = clean(item, testPath, true, counter)
      if (cleaned !== DROP) kept.push(cleaned)
    }
    return kept
  }
  if (isRecord(value)) {
    const field = pathFieldOf(value)
    if (field !== null) {
      const candidate = uriToPath(field)
      if (candidate !== null && testPath(candidate)) {
        counter.removed += 1
        return DROP
      }
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const cleaned = clean(item, testPath, PATH_LIST_KEYS.has(key), counter)
      if (cleaned !== DROP) out[key] = cleaned
    }
    return out
  }
  return value
}

export interface FilterResult<T> {
  value: T
  removed: number
}

export function filterResultPaths<T>(value: T, testPath: (candidate: string) => boolean): FilterResult<T> {
  const counter = { removed: 0 }
  const cleaned = clean(value, testPath, Array.isArray(value), counter)
  if (cleaned === DROP) return { value: null as T, removed: counter.removed }
  return { value: cleaned as T, removed: counter.removed }
}

export function stripPromptFiles<T>(files: T, testPath: (candidate: string) => boolean): FilterResult<T> {
  if (!Array.isArray(files)) return { value: files, removed: 0 }
  let removed = 0
  const kept = files.filter((item) => {
    if (!isRecord(item) || typeof item.uri !== "string") return true
    const candidate = uriToPath(item.uri)
    if (candidate === null || !testPath(candidate)) return true
    removed += 1
    return false
  })
  return { value: kept as T, removed }
}
