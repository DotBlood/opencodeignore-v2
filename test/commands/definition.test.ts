import { describe, expect, test } from "bun:test"
import { AGENTIGNORE_TEMPLATE, ignoreUsage, toggleEffect } from "../../src/commands/definition.ts"

describe("toggleEffect", () => {
  test("flips ask and deny", () => {
    expect(toggleEffect("ask")).toBe("deny")
    expect(toggleEffect("deny")).toBe("ask")
  })
})

describe("template", () => {
  test("ships a commented starter", () => {
    expect(AGENTIGNORE_TEMPLATE.startsWith("# .agentignore")).toBe(true)
    expect(AGENTIGNORE_TEMPLATE).toContain(".gitignore")
    expect(ignoreUsage()).toContain("/ignore-init")
  })
})
