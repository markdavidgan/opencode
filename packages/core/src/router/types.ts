export * as RouterTypes from "./types"

export type Complexity = "trivial" | "bounded" | "architectural" | "exploratory" | "unknown"
export type Scope = "single-file" | "multi-file" | "system-wide" | "unknown"
export type Reasoning = "none" | "linear" | "recursive" | "unknown"

export interface UserTurn {
  readonly content: string
}

export interface TaskProfile {
  readonly complexity: Complexity
  readonly scope: Scope
  readonly reasoning: Reasoning
  readonly codeGenExpected: boolean
  readonly toolUseExpected: boolean
  readonly longContextExpected: boolean
}

export interface ContextScope {
  readonly type: "minimal" | "bounded" | "full" | "architectural"
  readonly includeHistory: boolean
  readonly historyDepth: number
  readonly headRatio: number
  readonly includeFileTree: boolean
  readonly includeDecisions: boolean
  readonly includeDiff: boolean
}

export interface CostEstimate {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly inputRate: number
  readonly outputRate: number
  readonly estimatedTotalUsd: number
}

export interface RouteDecision {
  readonly provider: string
  readonly model: string
  readonly scope: ContextScope
  readonly reasoning: string
  readonly estimatedCost: CostEstimate
}

export interface Override {
  readonly provider?: string
  readonly model?: string
  readonly scopeType?: ContextScope["type"]
}

export interface ScopeOverride {
  readonly type: ContextScope["type"]
}
