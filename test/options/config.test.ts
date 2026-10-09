import { describe, expect, test } from "bun:test"
import { parseOptions } from "@options/config.ts"

describe("parseOptions", () => {
  test("defaults to deny with skill enabled", () => {
    expect(parseOptions(undefined)).toEqual({
      enabled: true,
      effect: "deny",
      skill: { enabled: true, compactLimit: 2000 },
      shellScan: false,
      gitHistory: false,
      respectGitignore: false,
    })
  })

  test("reads the enabled flag", () => {
    expect(parseOptions({ enabled: false }).enabled).toBe(false)
    expect(parseOptions({ enabled: "yes" }).enabled).toBe(false)
  })

  test("accepts ask effect", () => {
    expect(parseOptions({ effect: "ask" }).effect).toBe("ask")
  })

  test("falls back to deny on unknown effect", () => {
    expect(parseOptions({ effect: "block" }).effect).toBe("deny")
  })

  test("disables skill with false", () => {
    expect(parseOptions({ skill: false }).skill.enabled).toBe(false)
  })

  test("clamps compact limit", () => {
    expect(parseOptions({ skill: { compactLimit: -5 } }).skill.compactLimit).toBe(0)
    expect(parseOptions({ skill: { compactLimit: 999999 } }).skill.compactLimit).toBe(20000)
  })
})
