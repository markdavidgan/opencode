export * as RouterClassifier from "./classifier"

import { RouterTypes } from "./types"

export function classifyHeuristic(turn: RouterTypes.UserTurn): RouterTypes.TaskProfile {
  const text = turn.content.toLowerCase()

  if (text.match(/\bfix\b.*\b(typo|spelling|grammar|indent|format)\b/))
    return {
      complexity: "trivial",
      scope: "single-file",
      reasoning: "none",
      codeGenExpected: true,
      toolUseExpected: false,
      longContextExpected: false,
    }

  if (text.match(/\badd\b.*\b(comment|log|print|console)\b/))
    return {
      complexity: "trivial",
      scope: "single-file",
      reasoning: "none",
      codeGenExpected: true,
      toolUseExpected: false,
      longContextExpected: false,
    }

  if (text.match(/\b(refactor|restructure|architect|design|migrate|rewrite)\b/))
    return {
      complexity: "architectural",
      scope: "multi-file",
      reasoning: "recursive",
      codeGenExpected: true,
      toolUseExpected: true,
      longContextExpected: true,
    }

  if (text.match(/\b(plan|strategy|approach|evaluate|compare.*options)\b/))
    return {
      complexity: "architectural",
      scope: "system-wide",
      reasoning: "recursive",
      codeGenExpected: false,
      toolUseExpected: true,
      longContextExpected: true,
    }

  if (text.match(/\b(tests?|spec|unit tests?|coverage)\b/))
    return {
      complexity: "bounded",
      scope: "multi-file",
      reasoning: "linear",
      codeGenExpected: true,
      toolUseExpected: false,
      longContextExpected: false,
    }

  if (text.match(/\b(implement|create|add.*features?|build)\b/))
    return {
      complexity: "bounded",
      scope: "multi-file",
      reasoning: "linear",
      codeGenExpected: true,
      toolUseExpected: true,
      longContextExpected: false,
    }

  return {
    complexity: "unknown",
    scope: "unknown",
    reasoning: "unknown",
    codeGenExpected: true,
    toolUseExpected: true,
    longContextExpected: false,
  }
}
