import { Effect } from "effect"
import { Catalog } from "../catalog"
import { ConfigRouter } from "../config/router"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionMessage } from "../session/message"
import { RouterClassifier } from "./classifier"
import { RouterCompactor } from "./compactor"
import { RouterCost } from "./cost"
import { RouterSelector } from "./selector"
import { RouterTypes } from "./types"

export * from "./types"
export { RouterClassifier as Classifier } from "./classifier"
export { RouterCompactor as Compactor } from "./compactor"
export { RouterSelector as Selector } from "./selector"
export { RouterCost as Cost } from "./cost"
export { RouterTokenizer as Tokenizer } from "./tokenizer"
export { RouterAvailability as Availability } from "./availability"
export { RouterDecisions as Decisions } from "./decisions"
export { RouterFallback as Fallback } from "./fallback"
export { RouterConfig as Config } from "./config"
export { RouterOverride as Override } from "./override"

export interface RouteInput {
  readonly turn: RouterTypes.UserTurn
  readonly messages: SessionMessage.Message[]
  readonly config?: ConfigRouter.Info
  readonly currentModel?: ModelV2.Ref
  readonly override?: RouterTypes.Override
}

export interface RouteResult {
  readonly decision: RouterTypes.RouteDecision
  readonly scopedMessages: SessionMessage.Message[]
  readonly wasOverridden: boolean
}

export const route = Effect.fn("Router.route")((input: RouteInput) =>
  Effect.gen(function* () {
    const resolved = ConfigRouter.resolve(input.config)

    if (input.override?.provider && input.override?.model) {
      const decision = yield* overrideDecision(input.override, input.messages, resolved)
      const scopedMessages = RouterCompactor.compact(input.messages, decision.scope)
      return { profile: { complexity: "unknown", scope: "unknown", reasoning: "none", codeGenExpected: false, toolUseExpected: false, longContextExpected: false }, decision, scopedMessages, wasOverridden: true }
    }

    const profile = RouterClassifier.classifyHeuristic(input.turn)
    const scope = scopeFor(profile, resolved, input.override?.scopeType)
    const decision = yield* RouterSelector.select(profile, scope, resolved, input.currentModel)
    const scopedMessages = RouterCompactor.compact(input.messages, decision.scope)

    return { profile, decision, scopedMessages, wasOverridden: false }
  }),
)

function overrideDecision(
  override: RouterTypes.Override,
  messages: SessionMessage.Message[],
  config: ConfigRouter.Info,
) {
  return Effect.gen(function* () {
    if (!override.provider || !override.model) return yield* Effect.die("Router override is missing provider or model")
    const catalog = yield* Catalog.Service
    const model = yield* catalog.model.get(ProviderV2.ID.make(override.provider), ModelV2.ID.make(override.model))

    const scopeType = override.scopeType ?? "full"
    const compaction = config.compaction!
    const scope: RouterTypes.ContextScope = {
      type: scopeType,
      includeHistory: scopeType !== "minimal",
      historyDepth: scopeType === "bounded" ? (compaction.bounded_history_depth ?? 5) : 0,
      headRatio: scopeType === "bounded" ? (compaction.bounded_head_ratio ?? 0.2) : 0,
      includeFileTree: scopeType === "architectural" || scopeType === "full",
      includeDecisions: true,
      includeDiff: scopeType === "architectural",
    }

    const briefText = scopeSummary(scope)
    const outputTokens = 1000
    const inputTokens = RouterCost.estimateTokens(briefText, override.provider, override.model)
    const estimate = RouterCost.estimateCost(inputTokens, outputTokens, model)

    return {
      provider: override.provider,
      model: override.model,
      scope,
      reasoning: `Manual override to ${override.provider}/${override.model} with ${scopeType} scope`,
      estimatedCost: {
        inputTokens,
        outputTokens,
        inputRate: estimate.inputRate,
        outputRate: estimate.outputRate,
        estimatedTotalUsd: estimate.estimatedTotalUsd,
      },
    }
  })
}

export function scopeFor(
  profile: RouterTypes.TaskProfile,
  config: ConfigRouter.Info,
  scopeOverride?: RouterTypes.ContextScope["type"],
): RouterTypes.ContextScope {
  const compaction = config.compaction!
  const boundedHeadRatio = compaction.bounded_head_ratio ?? 0.2

  if (scopeOverride) {
    return {
      type: scopeOverride,
      includeHistory: scopeOverride !== "minimal",
      historyDepth: scopeOverride === "bounded" ? (compaction.bounded_history_depth ?? 5) : 0,
      headRatio: scopeOverride === "bounded" ? boundedHeadRatio : 0,
      includeFileTree: scopeOverride === "architectural" || scopeOverride === "full",
      includeDecisions: true,
      includeDiff: scopeOverride === "architectural",
    }
  }

  if (profile.complexity === "trivial") {
    return {
      type: "minimal",
      includeHistory: false,
      historyDepth: compaction.minimal_history_depth ?? 0,
      headRatio: 0,
      includeFileTree: false,
      includeDecisions: true,
      includeDiff: false,
    }
  }

  if (profile.complexity === "architectural") {
    return {
      type: "full",
      includeHistory: true,
      historyDepth: 0,
      headRatio: 0,
      includeFileTree: true,
      includeDecisions: true,
      includeDiff: true,
    }
  }

  return {
    type: "bounded",
    includeHistory: true,
    historyDepth: compaction.bounded_history_depth ?? 5,
    headRatio: boundedHeadRatio,
    includeFileTree: false,
    includeDecisions: true,
    includeDiff: false,
  }
}

function scopeSummary(scope: RouterTypes.ContextScope): string {
  return `scope=${scope.type} history=${scope.includeHistory ? scope.historyDepth : 0} tree=${scope.includeFileTree} decisions=${scope.includeDecisions} diff=${scope.includeDiff}`
}
