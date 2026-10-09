export type IgnoreAction = "init" | "on" | "off" | "switch" | "status"

export function toggleEffect(effect: "ask" | "deny"): "ask" | "deny" {
  return effect === "ask" ? "deny" : "ask"
}

export function ignoreUsage(): string {
  return "commands: /ignore-init | /ignore-on | /ignore-off | /ignore-switch | /ignore-status"
}

export const AGENTIGNORE_TEMPLATE = [
  "# .agentignore: paths the agent must not touch.",
  "# Pattern syntax matches .gitignore: *, **, dir/, ! negation, # comments.",
  "# Sensitive entries should also live in .gitignore: history is outside this guard.",
  "# Examples (commented out):",
  "# secrets/",
  "# *.key",
  "# .env",
  "# /local-notes/",
  "",
].join("\n")
