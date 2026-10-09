import { describe, expect, test } from "bun:test"
import { decideForResources } from "@guard/decide.ts"
import { parseOptions } from "@options/config.ts"

const options = parseOptions(undefined)
const testPath = (value: string): boolean => value.split("/").includes("dist")

describe("decideForResources", () => {
  test("denies reads of ignored paths", () => {
    const decision = decideForResources("read", ["src/a.ts", "dist/b.js"], testPath, options)
    expect(decision).toEqual({
      effect: "deny",
      message: "Blocked by .agentignore (read dist/b.js). Proceed only with explicit user approval.",
    })
  })

  test("allows reads outside the guarded set", () => {
    expect(decideForResources("read", ["src/a.ts"], testPath, options)).toEqual({ effect: "allow" })
  })

  test("skips non string resources", () => {
    expect(decideForResources("edit", [42, "src/a.ts"], testPath, options)).toEqual({ effect: "allow" })
  })

  test("leaves shell alone unless shellScan is on", () => {
    expect(decideForResources("shell", ["cat dist/b.js"], testPath, options)).toEqual({ effect: "allow" })
    const scanned = parseOptions({ shellScan: true })
    const decision = decideForResources("shell", ["cat dist/b.js"], testPath, scanned)
    expect(decision.effect).toBe("deny")
  })
})

describe("decideForResources git history", () => {
  const scanned = parseOptions({ shellScan: true, gitHistory: true })
  const gitPath = (value: string): boolean => value === "secrets/key" || value.split("/").includes("dist")

  test("blocks rev:path references to guarded files", () => {
    const decision = decideForResources("shell", ["git show HEAD:secrets/key"], gitPath, scanned)
    expect(decision.effect).toBe("deny")
  })

  test("blocks bare content-emitting forms while rules exist", () => {
    expect(decideForResources("shell", ["git log -p"], gitPath, scanned).effect).toBe("deny")
    expect(decideForResources("shell", ["git show HEAD"], gitPath, scanned).effect).toBe("deny")
    expect(decideForResources("shell", ["git diff --cached"], gitPath, scanned).effect).toBe("deny")
    expect(decideForResources("shell", ["git stash show -p"], gitPath, scanned).effect).toBe("deny")
  })

  test("allows bare forms without rules", () => {
    expect(decideForResources("shell", ["git log -p"], gitPath, scanned, false)).toEqual({ effect: "allow" })
  })

  test("allows metadata-only and path-restricted reads", () => {
    expect(decideForResources("shell", ["git log --oneline"], gitPath, scanned)).toEqual({ effect: "allow" })
    expect(decideForResources("shell", ["git status"], gitPath, scanned)).toEqual({ effect: "allow" })
    expect(decideForResources("shell", ["git show HEAD -- src/ok.ts"], gitPath, scanned)).toEqual({
      effect: "allow",
    })
  })

  test("sees through prefixes and git dir flags", () => {
    expect(decideForResources("shell", ["sudo git log -p"], gitPath, scanned).effect).toBe("deny")
    expect(decideForResources("shell", ["git -C sub log -p"], gitPath, scanned).effect).toBe("deny")
    expect(decideForResources("shell", ["git stash"], gitPath, scanned)).toEqual({ effect: "allow" })
  })

  test("keeps the two shell flags independent", () => {
    const historyOnly = parseOptions({ gitHistory: true })
    expect(decideForResources("shell", ["git log -p"], gitPath, historyOnly).effect).toBe("deny")
    expect(decideForResources("shell", ["cat dist/b.js"], gitPath, historyOnly)).toEqual({ effect: "allow" })
    const scanOnly = parseOptions({ shellScan: true })
    expect(decideForResources("shell", ["git log -p"], gitPath, scanOnly)).toEqual({ effect: "allow" })
    expect(decideForResources("shell", ["git show HEAD:secrets/key"], gitPath, scanOnly)).toEqual({
      effect: "allow",
    })
  })
})
