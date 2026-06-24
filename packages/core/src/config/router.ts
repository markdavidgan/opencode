export * as ConfigRouter from "./router"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

const Percentage = Schema.Number

export const Mode = Schema.Literals(["auto", "manual", "suggest"])
export type Mode = typeof Mode.Type

export const ClassifierStrategy = Schema.Literals(["heuristic", "llm", "hybrid"])
export type ClassifierStrategy = typeof ClassifierStrategy.Type

export const ScopeType = Schema.Literals(["minimal", "bounded", "full", "architectural"])
export type ScopeType = typeof ScopeType.Type

export const FallbackAction = Schema.Literals(["next-cheapest", "upgrade-model", "block"])
export type FallbackAction = typeof FallbackAction.Type

export const BudgetAction = Schema.Literals(["warn", "block", "downgrade"])
export type BudgetAction = typeof BudgetAction.Type

export class TierEntry extends Schema.Class<TierEntry>("ConfigV2.Router.TierEntry")({
  provider: Schema.String,
  model: Schema.String,
}) {}

export class Tiers extends Schema.Class<Tiers>("ConfigV2.Router.Tiers")({
  trivial: Schema.Array(TierEntry).pipe(Schema.optional),
  bounded: Schema.Array(TierEntry).pipe(Schema.optional),
  architectural: Schema.Array(TierEntry).pipe(Schema.optional),
}) {}

export class Classifier extends Schema.Class<Classifier>("ConfigV2.Router.Classifier")({
  strategy: ClassifierStrategy.pipe(Schema.optional),
  llm_model: Schema.String.pipe(Schema.optional),
  confidence_threshold: Percentage.pipe(Schema.optional),
}) {}

export class Compaction extends Schema.Class<Compaction>("ConfigV2.Router.Compaction")({
  minimal_history_depth: Schema.Number.pipe(Schema.optional),
  bounded_history_depth: Schema.Number.pipe(Schema.optional),
  bounded_head_ratio: Percentage.pipe(Schema.optional),
  tool_result_clearing_age: PositiveInt.pipe(Schema.optional),
  preserve_in_flight_tool_calls: Schema.Boolean.pipe(Schema.optional),
}) {}

export class CostTracking extends Schema.Class<CostTracking>("ConfigV2.Router.CostTracking")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  show_estimate_before_send: Schema.Boolean.pipe(Schema.optional),
  currency: Schema.String.pipe(Schema.optional),
  daily_budget: Schema.Number.pipe(Schema.optional),
  on_budget_exceeded: BudgetAction.pipe(Schema.optional),
}) {}

export class Fallback extends Schema.Class<Fallback>("ConfigV2.Router.Fallback")({
  on_rate_limit: FallbackAction.pipe(Schema.optional),
  on_auth_failure: FallbackAction.pipe(Schema.optional),
  on_context_window_exceeded: FallbackAction.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Router")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  mode: Mode.pipe(Schema.optional),
  classifier: Classifier.pipe(Schema.optional),
  compaction: Compaction.pipe(Schema.optional),
  tiers: Tiers.pipe(Schema.optional),
  cost_tracking: CostTracking.pipe(Schema.optional),
  fallback: Fallback.pipe(Schema.optional),
  blacklist: Schema.Array(Schema.String).pipe(Schema.optional),
  whitelist: Schema.Array(Schema.String).pipe(Schema.optional),
}) {}

const defaultClassifier = new Classifier({
  strategy: "hybrid",
  llm_model: "openai/gpt-4o-mini",
  confidence_threshold: 0.7,
})

const defaultCompaction = new Compaction({
  minimal_history_depth: 0,
  bounded_history_depth: 5,
  bounded_head_ratio: 0.2,
  tool_result_clearing_age: 3,
  preserve_in_flight_tool_calls: true,
})

const defaultTiers = new Tiers({
  trivial: [
    new TierEntry({ provider: "openai", model: "gpt-4o-mini" }),
    new TierEntry({ provider: "kimi-for-coding-oauth", model: "kimi-for-coding" }),
  ],
  bounded: [
    new TierEntry({ provider: "google", model: "gemini-2.5-flash" }),
    new TierEntry({ provider: "anthropic", model: "claude-sonnet-4" }),
  ],
  architectural: [
    new TierEntry({ provider: "anthropic", model: "claude-opus-4" }),
    new TierEntry({ provider: "openai", model: "gpt-5" }),
  ],
})

const defaultCostTracking = new CostTracking({
  enabled: true,
  show_estimate_before_send: false,
  currency: "USD",
})

const defaultFallback = new Fallback({
  on_rate_limit: "next-cheapest",
  on_auth_failure: "next-cheapest",
  on_context_window_exceeded: "upgrade-model",
})

export const defaults: Info = new Info({
  enabled: true,
  mode: "auto",
  classifier: defaultClassifier,
  compaction: defaultCompaction,
  tiers: defaultTiers,
  cost_tracking: defaultCostTracking,
  fallback: defaultFallback,
})

export function resolve(input: Info | undefined): Info {
  if (!input) return defaults

  return new Info({
    enabled: input.enabled ?? defaults.enabled,
    mode: input.mode ?? defaults.mode,
    classifier: input.classifier
      ? new Classifier({
          strategy: input.classifier.strategy ?? defaultClassifier.strategy,
          llm_model: input.classifier.llm_model ?? defaultClassifier.llm_model,
          confidence_threshold: input.classifier.confidence_threshold ?? defaultClassifier.confidence_threshold,
        })
      : defaultClassifier,
    compaction: input.compaction
      ? new Compaction({
          minimal_history_depth: input.compaction.minimal_history_depth ?? defaultCompaction.minimal_history_depth,
          bounded_history_depth: input.compaction.bounded_history_depth ?? defaultCompaction.bounded_history_depth,
          bounded_head_ratio: input.compaction.bounded_head_ratio ?? defaultCompaction.bounded_head_ratio,
          tool_result_clearing_age: input.compaction.tool_result_clearing_age ?? defaultCompaction.tool_result_clearing_age,
          preserve_in_flight_tool_calls:
            input.compaction.preserve_in_flight_tool_calls ?? defaultCompaction.preserve_in_flight_tool_calls,
        })
      : defaultCompaction,
    tiers: input.tiers
      ? new Tiers({
          trivial: input.tiers.trivial ?? defaultTiers.trivial,
          bounded: input.tiers.bounded ?? defaultTiers.bounded,
          architectural: input.tiers.architectural ?? defaultTiers.architectural,
        })
      : defaultTiers,
    cost_tracking: input.cost_tracking
      ? new CostTracking({
          enabled: input.cost_tracking.enabled ?? defaultCostTracking.enabled,
          show_estimate_before_send:
            input.cost_tracking.show_estimate_before_send ?? defaultCostTracking.show_estimate_before_send,
          currency: input.cost_tracking.currency ?? defaultCostTracking.currency,
          daily_budget: input.cost_tracking.daily_budget ?? defaultCostTracking.daily_budget,
          on_budget_exceeded: input.cost_tracking.on_budget_exceeded ?? defaultCostTracking.on_budget_exceeded,
        })
      : defaultCostTracking,
    fallback: input.fallback
      ? new Fallback({
          on_rate_limit: input.fallback.on_rate_limit ?? defaultFallback.on_rate_limit,
          on_auth_failure: input.fallback.on_auth_failure ?? defaultFallback.on_auth_failure,
          on_context_window_exceeded:
            input.fallback.on_context_window_exceeded ?? defaultFallback.on_context_window_exceeded,
        })
      : defaultFallback,
    blacklist: input.blacklist ?? defaults.blacklist,
    whitelist: input.whitelist ?? defaults.whitelist,
  })
}
