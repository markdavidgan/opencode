export * as RouterCost from "./cost"

import { ModelV2 } from "../model"
import { RouterTokenizer } from "./tokenizer"

type Cost = ModelV2.Info["cost"][number]

export function estimateTokens(text: string, providerID: string, modelID?: string): number {
  return RouterTokenizer.forProvider(providerID, modelID).estimate(text)
}

export function estimateOutputTokens(complexity: string): number {
  if (complexity === "trivial") return 100
  if (complexity === "architectural") return 3000
  return 1000
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelV2.Info | undefined,
): {
  inputRate: number
  outputRate: number
  estimatedTotalUsd: number
} {
  if (!model || model.cost.length === 0) {
    return { inputRate: 0, outputRate: 0, estimatedTotalUsd: 0 }
  }

  const cost = applicableCost(model.cost, inputTokens)
  const inputRate = cost.input / 1_000_000
  const outputRate = cost.output / 1_000_000
  return {
    inputRate,
    outputRate,
    estimatedTotalUsd: inputTokens * inputRate + outputTokens * outputRate,
  }
}

export function actualCost(
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens?: number
    cacheWriteInputTokens?: number
  },
  model: ModelV2.Info | undefined,
): number {
  if (!model || model.cost.length === 0) return 0

  const cost = applicableCost(model.cost, usage.inputTokens)
  const inputRate = cost.input / 1_000_000
  const outputRate = cost.output / 1_000_000
  const cacheReadRate = cost.cache.read / 1_000_000
  const cacheWriteRate = cost.cache.write / 1_000_000

  const nonCachedInput = Math.max(0, usage.inputTokens - (usage.cacheReadInputTokens ?? 0) - (usage.cacheWriteInputTokens ?? 0))

  return (
    nonCachedInput * inputRate +
    (usage.cacheReadInputTokens ?? 0) * cacheReadRate +
    (usage.cacheWriteInputTokens ?? 0) * cacheWriteRate +
    usage.outputTokens * outputRate
  )
}

function applicableCost(costs: Cost[], inputTokens: number): Cost {
  const sorted = [...costs].sort((a, b) => (a.tier?.size ?? 0) - (b.tier?.size ?? 0))
  let selected = sorted[0]
  if (!selected) return { input: 0, output: 0, cache: { read: 0, write: 0 } }

  for (const cost of sorted) {
    if (cost.tier && inputTokens > cost.tier.size) selected = cost
    else if (!cost.tier && !selected.tier) selected = cost
  }
  return selected
}
