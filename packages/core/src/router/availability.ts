export * as RouterAvailability from "./availability"

import { ConfigRouter } from "../config/router"

const failures = new Map<string, number>()
const unavailableUntil = new Map<string, number>()

export function isAvailable(providerID: string): boolean {
  const until = unavailableUntil.get(providerID)
  if (!until) return true
  if (Date.now() >= until) {
    unavailableUntil.delete(providerID)
    return true
  }
  return false
}

export function markUnavailable(providerID: string, config: ConfigRouter.Info): void {
  const resolved = ConfigRouter.resolve(config)
  const rateLimit = resolved.rate_limit!
  const count = (failures.get(providerID) ?? 0) + 1
  failures.set(providerID, count)

  const initial = rateLimit.initial_seconds ?? 60
  const max = rateLimit.max_seconds ?? 900
  const jitter = rateLimit.jitter ?? 0.25

  const base = initial * Math.pow(2, count - 1)
  const capped = Math.min(base, max)
  const jittered = capped * (1 + jitter * (2 * Math.random() - 1))
  unavailableUntil.set(providerID, Date.now() + Math.round(jittered * 1000))
}

export function markAvailable(providerID: string): void {
  failures.delete(providerID)
  unavailableUntil.delete(providerID)
}

export function reset(): void {
  failures.clear()
  unavailableUntil.clear()
}
