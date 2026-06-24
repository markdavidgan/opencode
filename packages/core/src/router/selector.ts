export * as RouterSelector from "./selector"

import { Effect } from "effect"
import { Catalog } from "../catalog"
import { ConfigRouter } from "../config/router"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { RouterAvailability } from "./availability"
import { RouterCost } from "./cost"
import { RouterTypes } from "./types"

const defaultStickyThreshold = 0.05

export function select(
  profile: RouterTypes.TaskProfile,
  scope: RouterTypes.ContextScope,
  config: ConfigRouter.Info,
  currentModel?: ModelV2.Ref,
): Effect.Effect<RouterTypes.RouteDecision, never, Catalog.Service> {
  return Effect.gen(function* () {
    const resolved = ConfigRouter.resolve(config)
    const tier = tierFor(profile)
    const catalog = yield* Catalog.Service

    const candidate = yield* selectBestInTier(tier, profile, scope, resolved, catalog, currentModel)
    if (candidate) return candidate

    const fallbackTier = tier === "architectural" ? "bounded" : "trivial"
    const fallbackCandidate = yield* selectBestInTier(fallbackTier, profile, scope, resolved, catalog, currentModel)
    if (fallbackCandidate) return fallbackCandidate

    return yield* fallbackDecision(profile, scope, resolved, catalog, currentModel, "No capable model available")
  })
}

function selectBestInTier(
  tier: "trivial" | "bounded" | "architectural",
  profile: RouterTypes.TaskProfile,
  scope: RouterTypes.ContextScope,
  config: ConfigRouter.Info,
  catalog: Catalog.Interface,
  currentModel?: ModelV2.Ref,
): Effect.Effect<RouterTypes.RouteDecision | undefined, never, Catalog.Service> {
  return Effect.gen(function* () {
    const entries = config.tiers![tier]
    if (!entries || entries.length === 0) return undefined

    const briefText = scopeSummary(scope)
    const outputTokens = RouterCost.estimateOutputTokens(profile.complexity)

    const candidates: Array<{
      entry: ConfigRouter.TierEntry
      model: ModelV2.Info
      inputTokens: number
      cost: number
    }> = []

    for (const entry of entries) {
      if (!isAllowed(entry.provider, config)) continue
      if (!RouterAvailability.isAvailable(entry.provider)) continue

      const providerID = ProviderV2.ID.make(entry.provider)
      const modelID = ModelV2.ID.make(entry.model)
      const model = yield* catalog.model.get(providerID, modelID)
      if (!model) continue
      if (profile.toolUseExpected && !model.capabilities.tools) continue

      const inputTokens = RouterCost.estimateTokens(briefText, entry.provider, entry.model)
      if (profile.longContextExpected && model.limit.context > 0 && inputTokens > model.limit.context) continue

      const estimate = RouterCost.estimateCost(inputTokens, outputTokens, model)
      candidates.push({ entry, model, inputTokens, cost: estimate.estimatedTotalUsd })
    }

    if (candidates.length === 0) return undefined

    candidates.sort((a, b) => a.cost - b.cost)
    const cheapest = candidates[0]
    if (!cheapest) return undefined

    const stay = currentModel
      ? candidates.find((c) => c.entry.provider === currentModel.providerID && c.entry.model === currentModel.id)
      : undefined
    const threshold = config.sticky_threshold_usd ?? defaultStickyThreshold
    if (stay && (cheapest.cost === 0 || stay.cost - cheapest.cost < threshold)) {
      return decisionFromCandidate(stay, profile, scope, "sticky threshold keeps current model")
    }

    return decisionFromCandidate(cheapest, profile, scope, `${profile.complexity} task routed to ${tier} tier`)
  })
}

function isAllowed(provider: string, config: ConfigRouter.Info): boolean {
  if (config.blacklist?.includes(provider)) return false
  if (config.whitelist && config.whitelist.length > 0 && !config.whitelist.includes(provider)) return false
  return true
}

function decisionFromCandidate(
  candidate: {
    entry: ConfigRouter.TierEntry
    model: ModelV2.Info
    inputTokens: number
    cost: number
  },
  profile: RouterTypes.TaskProfile,
  scope: RouterTypes.ContextScope,
  reasoning: string,
): RouterTypes.RouteDecision {
  const outputTokens = RouterCost.estimateOutputTokens(profile.complexity)
  const estimate = RouterCost.estimateCost(candidate.inputTokens, outputTokens, candidate.model)
  return {
    provider: candidate.entry.provider,
    model: candidate.entry.model,
    scope,
    reasoning: `${reasoning}: ${candidate.entry.provider}/${candidate.entry.model} (${profile.complexity})`,
    estimatedCost: {
      inputTokens: candidate.inputTokens,
      outputTokens,
      inputRate: estimate.inputRate,
      outputRate: estimate.outputRate,
      estimatedTotalUsd: estimate.estimatedTotalUsd,
    },
  }
}

function fallbackDecision(
  profile: RouterTypes.TaskProfile,
  scope: RouterTypes.ContextScope,
  config: ConfigRouter.Info,
  catalog: Catalog.Interface,
  currentModel: ModelV2.Ref | undefined,
  reason: string,
): Effect.Effect<RouterTypes.RouteDecision, never, Catalog.Service> {
  return Effect.gen(function* () {
    if (currentModel) {
      const model = yield* catalog.model.get(
        ProviderV2.ID.make(currentModel.providerID),
        ModelV2.ID.make(currentModel.id),
      )
      if (model) {
        const inputTokens = RouterCost.estimateTokens(scopeSummary(scope), currentModel.providerID, currentModel.id)
        const outputTokens = RouterCost.estimateOutputTokens(profile.complexity)
        const estimate = RouterCost.estimateCost(inputTokens, outputTokens, model)
        return {
          provider: currentModel.providerID,
          model: currentModel.id,
          scope,
          reasoning: `${reason}; falling back to current model ${currentModel.providerID}/${currentModel.id}`,
          estimatedCost: {
            inputTokens,
            outputTokens,
            inputRate: estimate.inputRate,
            outputRate: estimate.outputRate,
            estimatedTotalUsd: estimate.estimatedTotalUsd,
          },
        }
      }
    }

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
  })
}

function tierFor(profile: RouterTypes.TaskProfile): "trivial" | "bounded" | "architectural" {
  if (profile.complexity === "trivial") return "trivial"
  if (profile.complexity === "architectural") return "architectural"
  return "bounded"
}

function scopeSummary(scope: RouterTypes.ContextScope): string {
  return `scope=${scope.type} history=${scope.includeHistory ? scope.historyDepth : 0} tree=${scope.includeFileTree} decisions=${scope.includeDecisions} diff=${scope.includeDiff}`
}
