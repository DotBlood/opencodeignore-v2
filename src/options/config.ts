export interface SkillSettings {
  enabled: boolean
  compactLimit: number
}

export interface OpencodeignoreOptions {
  enabled: boolean
  effect: "ask" | "deny"
  skill: SkillSettings
  shellScan: boolean
  gitHistory: boolean
  respectGitignore: boolean
}

const DEFAULT_COMPACT_LIMIT = 2000
const MAX_COMPACT_LIMIT = 20000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseSkill(input: unknown): SkillSettings {
  if (input === false) return { enabled: false, compactLimit: DEFAULT_COMPACT_LIMIT }
  if (!isRecord(input)) return { enabled: true, compactLimit: DEFAULT_COMPACT_LIMIT }
  const enabled = input.enabled === undefined ? true : input.enabled === true
  const rawLimit = typeof input.compactLimit === "number" ? input.compactLimit : DEFAULT_COMPACT_LIMIT
  const compactLimit = Math.min(Math.max(Math.floor(rawLimit), 0), MAX_COMPACT_LIMIT)
  return { enabled, compactLimit }
}

export function parseOptions(input: unknown): OpencodeignoreOptions {
  const source = isRecord(input) ? input : {}
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    effect: source.effect === "ask" ? "ask" : "deny",
    skill: parseSkill(source.skill),
    shellScan: source.shellScan === true,
    gitHistory: source.gitHistory === true,
    respectGitignore: source.respectGitignore === true,
  }
}
