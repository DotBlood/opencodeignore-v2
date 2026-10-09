export function buildPolicyText(rules: string[], limit: number): string {
  const lines = [
    "Respect .agentignore. Paths below are off limits.",
    "Do not read, edit, search, attach, or reference them without explicit user approval.",
    "If a tool call is blocked, state the reason and stop.",
  ]
  if (rules.length === 0) {
    lines.push("No rules configured. All paths are allowed.")
    return lines.join("\n")
  }
  lines.push(`Rules (${rules.length}):`)
  let budget = Math.max(limit - lines.join("\n").length, 0)
  let shown = 0
  for (const rule of rules) {
    const entry = `- ${rule}`
    if (entry.length + 1 > budget) break
    lines.push(entry)
    budget -= entry.length + 1
    shown += 1
  }
  if (shown < rules.length) {
    lines.push(`... and ${rules.length - shown} more. Read .agentignore files for the full list.`)
  }
  return lines.join("\n")
}
