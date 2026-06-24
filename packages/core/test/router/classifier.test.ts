import { describe, expect, test } from "bun:test"
import { RouterClassifier } from "@opencode-ai/core/router/classifier"

describe("RouterClassifier", () => {
  test("classifies typo fixes as trivial", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "Fix the typo on line 42" })

    expect(profile.complexity).toBe("trivial")
    expect(profile.scope).toBe("single-file")
    expect(profile.reasoning).toBe("none")
  })

  test("classifies adding a comment as trivial", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "Add a console log to debug this" })

    expect(profile.complexity).toBe("trivial")
    expect(profile.scope).toBe("single-file")
  })

  test("classifies refactoring as architectural", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "Refactor auth to use JWT" })

    expect(profile.complexity).toBe("architectural")
    expect(profile.scope).toBe("multi-file")
    expect(profile.reasoning).toBe("recursive")
  })

  test("classifies planning as architectural", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "Plan the strategy and evaluate options" })

    expect(profile.complexity).toBe("architectural")
    expect(profile.scope).toBe("system-wide")
  })

  test("classifies test writing as bounded", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "Write unit tests for the JWT module" })

    expect(profile.complexity).toBe("bounded")
    expect(profile.scope).toBe("multi-file")
    expect(profile.reasoning).toBe("linear")
  })

  test("classifies feature implementation as bounded", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "Implement a new feature to export reports" })

    expect(profile.complexity).toBe("bounded")
    expect(profile.scope).toBe("multi-file")
  })

  test("classifies ambiguous prompts as unknown", () => {
    const profile = RouterClassifier.classifyHeuristic({ content: "What do you think about this file?" })

    expect(profile.complexity).toBe("unknown")
    expect(profile.scope).toBe("unknown")
  })
})
