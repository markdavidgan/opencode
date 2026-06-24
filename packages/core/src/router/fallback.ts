export * as RouterFallback from "./fallback"

import { ConfigRouter } from "../config/router"
import { RouterTypes } from "./types"

export type FailureKind = "rate-limit" | "auth-failure" | "context-window-exceeded"

export function action(kind: FailureKind, config: ConfigRouter.Info): ConfigRouter.FallbackAction {
  const resolved = ConfigRouter.resolve(config)
  const fallback = resolved.fallback!
  if (kind === "rate-limit") return fallback.on_rate_limit ?? "next-cheapest"
  if (kind === "auth-failure") return fallback.on_auth_failure ?? "next-cheapest"
  return fallback.on_context_window_exceeded ?? "upgrade-model"
}

export function isRecoverable(kind: FailureKind): boolean {
  return kind !== "context-window-exceeded"
}

export function nextDecision(
  previous: RouterTypes.RouteDecision,
  kind: FailureKind,
  _config: ConfigRouter.Info,
): RouterTypes.RouteDecision {
  return {
    ...previous,
    reasoning: `${previous.reasoning}; fallback triggered (${kind})`,
  }
}
