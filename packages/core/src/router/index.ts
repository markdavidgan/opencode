import { SessionMessage } from "../session/message"
import { ConfigRouter } from "../config/router"
import { RouterClassifier } from "./classifier"
import { RouterCompactor } from "./compactor"
import { RouterSelector } from "./selector"
import { RouterTypes } from "./types"

export * from "./types"
export { RouterClassifier as Classifier } from "./classifier"
export { RouterCompactor as Compactor } from "./compactor"
export { RouterSelector as Selector } from "./selector"
export { RouterCost as Cost } from "./cost"
export { RouterDecisions as Decisions } from "./decisions"
export { RouterFallback as Fallback } from "./fallback"
export { RouterConfig as Config } from "./config"

export interface RouteInput {
  readonly turn: RouterTypes.UserTurn
  readonly messages: SessionMessage.Message[]
  readonly config?: ConfigRouter.Info
}

export interface RouteResult {
  readonly decision: RouterTypes.RouteDecision
  readonly scopedMessages: SessionMessage.Message[]
}

export function route(input: RouteInput): RouteResult {
  const resolved = ConfigRouter.resolve(input.config)
  const profile = RouterClassifier.classifyHeuristic(input.turn)
  const scope = scopeFor(profile, resolved)
  const decision = RouterSelector.select(profile, scope, resolved)
  const scopedMessages = RouterCompactor.compact(input.messages, scope)

  return { decision, scopedMessages }
}

function scopeFor(profile: RouterTypes.TaskProfile, config: ConfigRouter.Info): RouterTypes.ContextScope {
  const compaction = config.compaction!

  if (profile.complexity === "trivial") {
    return {
      type: "minimal",
      includeHistory: false,
      historyDepth: compaction.minimal_history_depth ?? 0,
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
      includeFileTree: true,
      includeDecisions: true,
      includeDiff: true,
    }
  }

  return {
    type: "bounded",
    includeHistory: true,
    historyDepth: compaction.bounded_history_depth ?? 5,
    includeFileTree: false,
    includeDecisions: true,
    includeDiff: false,
  }
}
