export * as RouterTokenizer from "./tokenizer"

import { encodingForModel } from "js-tiktoken"

export interface Estimator {
  readonly estimate: (text: string) => number
}

export function fallback(text: string): number {
  if (text.length === 0) return 0
  return Math.max(1, Math.ceil((text.length / 4) * 1.2))
}

export function forProvider(providerID: string, modelID?: string): Estimator {
  if (providerID === "openai" || providerID === "openai-compatible" || providerID === "azure-openai") {
    const encoder = openaiEstimator(modelID)
    if (encoder) return encoder
  }

  return { estimate: fallback }
}

function openaiEstimator(modelID: string | undefined): Estimator | undefined {
  if (!modelID) return undefined

  try {
    const encoder = encodingForModel(modelID as any)
    return {
      estimate: (text: string) => {
        if (text.length === 0) return 0
        return encoder.encode(text, "all", "all").length
      },
    }
  } catch {
    return undefined
  }
}
