export * as RouterCost from "./cost"

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0

  const words = text.trim().split(/\s+/).length
  // Approximate 0.75 words per token for English/code text.
  return Math.max(1, Math.ceil(words / 0.75))
}

export function estimateOutputTokens(complexity: string): number {
  if (complexity === "trivial") return 100
  if (complexity === "bounded") return 1000
  if (complexity === "architectural") return 3000
  return 1000
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  // Phase 1: placeholder rates; real rates come from provider-specific tokenizers later.
  const inputRate = 0
  const outputRate = 0
  return inputTokens * inputRate + outputTokens * outputRate
}
