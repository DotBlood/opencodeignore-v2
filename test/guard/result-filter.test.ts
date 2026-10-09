import { describe, expect, test } from "bun:test"
import { filterResultPaths, stripPromptFiles } from "@guard/result-filter.ts"

const testPath = (value: string): boolean => value.includes("dist")

describe("filterResultPaths", () => {
  test("filters bare path lists", () => {
    const result = filterResultPaths(["src/a.ts", "dist/b.js"], testPath)
    expect(result).toEqual({ value: ["src/a.ts"], removed: 1 })
  })

  test("drops records whose path field is guarded", () => {
    const input = [
      { path: "dist/b.js", line: 1 },
      { path: "src/a.ts", line: 2 },
    ]
    const result = filterResultPaths(input, testPath)
    expect(result).toEqual({ value: [{ path: "src/a.ts", line: 2 }], removed: 1 })
  })

  test("keeps prose that mentions guarded paths", () => {
    const input = { text: "dist/b.js is mentioned here" }
    expect(filterResultPaths(input, testPath)).toEqual({ value: input, removed: 0 })
  })
})

describe("stripPromptFiles", () => {
  test("removes guarded file attachments", () => {
    const files = [{ uri: "file:///proj/dist/b.js" }, { uri: "file:///proj/src/a.ts" }]
    const result = stripPromptFiles(files, testPath)
    expect(result).toEqual({ value: [{ uri: "file:///proj/src/a.ts" }], removed: 1 })
  })
})
