export * as RouterSelector from "./selector"

import { ConfigRouter } from "../config/router"
import { RouterCost } from "./cost"
import { RouterTypes } from "./types"

export function select(
  profile: RouterTypes.TaskProfile,
  scope: RouterTypes.ContextScope,
  config: ConfigRouter.Info,
): RouterTypes.RouteDecision {
  const resolved = ConfigRouter.resolve(config)
  const tier = tierFor(profile)
  const entry = resolved.tiers![tier]?.[0]
  if (!entry) return fallbackDecision(profile, scope, resolved, `No tier configured for ${tier}`)

  const inputTokens = RouterCost.estimateTokens(scopeSummary(scope))
  const outputTokens = RouterCost.estimateOutputTokens(profile.complexity)
  const estimatedTotalUsd = RouterCost.estimateCost(inputTokens, outputTokens)

  return {
    provider: entry.provider,
    model: entry.model,
    scope,
    reasoning: `${profile.complexity} task (${tier}) routed to ${entry.provider}/${entry.model} with ${scope.type} scope`,
    estimatedCost: {
      inputTokens,
      outputTokens,
      inputRate: 0,
      outputRate: 0,
      estimatedTotalUsd,
    },
  }
}

function tierFor(profile: RouterTypes.TaskProfile): "trivial" | "bounded" | "architectural" {
  if (profile.complexity === "trivial") return "trivial"
  if (profile.complexity === "architectural") return "architectural"
  return "bounded"
}

function scopeSummary(scope: RouterTypes.ContextScope): string {
  return `scope=${scope.type} history=${scope.includeHistory ? scope.historyDepth : 0} tree=${scope.includeFileTree} decisions=${scope.includeDecisions} diff=${scope.includeDiff}`
}

function fallbackDecision(
  profile: RouterTypes.TaskProfile,
  scope: RouterTypes.ContextScope,
  config: ConfigRouter.Info,
  reason: string,
): RouterTypes.RouteDecision {
  const firstTier = config.tiers?.bounded?.[0] ?? config.tiers?.architectural?.[0] ?? { provider: "unknown", model: "unknown" }
  return {
    provider: firstTier.provider,
    model: firstTier.model,
    scope,
    reasoning: `${reason}; falling back to ${firstTier.provider}/${firstTier.model}`,
    estimatedCost: {
      inputTokens: 0,
      outputTokens: 0,
      inputRate: 0,
      outputRate: 0,
      estimatedTotalUsd: 0,
    },
  }
}
