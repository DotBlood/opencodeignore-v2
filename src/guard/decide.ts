import type { OpencodeignoreOptions } from "@options/config.js"

export type Decision = { effect: "allow" } | { effect: "ask" | "deny"; message: string }

function splitTokens(command: string): string[] {
  return command
    .split(/[\s"'`]+/)
    .map((token) => token.replace(/^[(\[{]+/, "").replace(/[)\]},;:]+$/, ""))
    .filter((token) => token.length > 0)
}

function looksLikePath(token: string): boolean {
  // Shell text is unstructured, so only explicit path tokens count.
  return token.includes("/") || token.startsWith("./") || token.startsWith("../")
}

const HISTORY_READERS = new Set(["show", "log", "diff", "blame", "grep", "cat-file", "archive"])
const PREFIX_COMMANDS = new Set(["sudo", "env", "command"])
const DIR_FLAGS = new Set(["-C", "--git-dir", "--work-tree"])

interface GitCommand {
  sub: string
  args: string[]
}

function parseGitCommand(tokens: string[]): GitCommand | null {
  let i = 0
  while (i < tokens.length) {
    const head = tokens[i]
    if (head === undefined) return null
    if (!PREFIX_COMMANDS.has(head.toLowerCase()) && !head.includes("=")) break
    i += 1
  }
  if (tokens[i]?.toLowerCase() !== "git") return null
  i += 1
  while (i < tokens.length) {
    const flag = tokens[i]
    if (flag === undefined) return null
    if (DIR_FLAGS.has(flag)) {
      i += 2
      continue
    }
    if (flag.startsWith("-")) {
      i += 1
      continue
    }
    break
  }
  const sub = tokens[i]?.toLowerCase()
  if (sub === undefined || sub === "") return null
  const args = tokens.slice(i + 1)
  if (sub === "stash") {
    const showAt = args.findIndex((token) => !token.startsWith("-") && token.toLowerCase() === "show")
    if (showAt === -1) return null
    return { sub: "show", args: args.slice(showAt + 1) }
  }
  return { sub, args }
}

function stripRevPrefix(token: string): string | null {
  const cut = token.indexOf(":")
  if (cut <= 0) return null
  if (token.slice(0, cut).includes("/")) return null
  return token.slice(cut + 1)
}

function emitsContentWithoutPaths(sub: string, args: string[]): boolean {
  if (!HISTORY_READERS.has(sub)) return false
  if (args.some((token) => looksLikePath(token) && !token.startsWith("-"))) return false
  switch (sub) {
    case "log":
      return args.some(
        (token) =>
          token === "-p" ||
          token === "--patch" ||
          token === "--patch-with-stat" ||
          token === "-G" ||
          token === "-S" ||
          token.startsWith("-G") ||
          token.startsWith("-S") ||
          token.startsWith("-U") ||
          token.startsWith("--unified"),
      )
    case "show":
    case "diff":
    case "grep":
    case "archive":
      return true
    case "cat-file":
      return args.includes("-p")
    default:
      return false
  }
}

export function decideForResources(
  action: string,
  resources: readonly unknown[],
  testPath: (value: string) => boolean,
  options: OpencodeignoreOptions,
  hasRules = true,
): Decision {
  if (action === "read" || action === "edit") {
    for (const resource of resources) {
      if (typeof resource !== "string" || !testPath(resource)) continue
      return {
        effect: options.effect,
        message: `Blocked by .agentignore (${action} ${resource}). Proceed only with explicit user approval.`,
      }
    }
    return { effect: "allow" }
  }
  if (action === "shell" && (options.shellScan || options.gitHistory)) {
    for (const resource of resources) {
      if (typeof resource !== "string") continue
      const tokens = splitTokens(resource)
      if (options.shellScan) {
        for (const token of tokens) {
          if (!looksLikePath(token) || !testPath(token)) continue
          return {
            effect: options.effect,
            message: `Blocked by .agentignore (shell references ${token}). Proceed only with explicit user approval.`,
          }
        }
      }
      if (options.gitHistory) {
        const git = parseGitCommand(tokens)
        if (git !== null) {
          for (const token of tokens) {
            const stripped = stripRevPrefix(token)
            if (stripped === null || !testPath(stripped)) continue
            return {
              effect: options.effect,
              message: `Blocked by .agentignore (git ${git.sub} references ${token}). Proceed only with explicit user approval.`,
            }
          }
          if (emitsContentWithoutPaths(git.sub, git.args) && hasRules) {
            return {
              effect: options.effect,
              message: `Blocked by .agentignore (git ${git.sub} can expose guarded file contents). Proceed only with explicit user approval.`,
            }
          }
        }
      }
    }
  }
  return { effect: "allow" }
}
