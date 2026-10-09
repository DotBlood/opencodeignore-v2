import { describe, expect, test } from "bun:test"
import { buildPolicyText } from "../../src/skill/policy-text.ts"

describe("buildPolicyText", () => {
  test("states the empty case", () => {
    expect(buildPolicyText([], 2000)).toContain("No rules configured")
  })

  test("truncates long rule lists within budget", () => {
    const rules = Array.from({ length: 50 }, (_, index) => `rule-${index}/`)
    const text = buildPolicyText(rules, 200)
    expect(text.length).toBeLessThanOrEqual(400)
    expect(text).toContain("more")
  })
})
