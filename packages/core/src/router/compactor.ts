export * as RouterCompactor from "./compactor"

import { SessionMessage } from "../session/message"
import { RouterTypes } from "./types"

export function compact(
  messages: SessionMessage.Message[],
  scope: RouterTypes.ContextScope,
): SessionMessage.Message[] {
  if (scope.type === "full") return messages
  if (scope.type === "architectural") return messages
  if (scope.type === "bounded") return bounded(messages, scope)
  return minimal(messages)
}

function isInFlight(message: SessionMessage.Message): boolean {
  if (message.type !== "assistant") return false
  return message.content.some(
    (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
  )
}

function minimal(messages: SessionMessage.Message[]): SessionMessage.Message[] {
  const system = messages.filter((message) => message.type === "system")
  const user = messages.filter((message) => message.type === "user")
  const last = user.at(-1)
  if (!last) return system
  return [...system, last]
}

function bounded(messages: SessionMessage.Message[], scope: RouterTypes.ContextScope): SessionMessage.Message[] {
  if (!scope.includeHistory || scope.historyDepth <= 0) return minimal(messages)

  const system = messages.filter((message) => message.type === "system")
  const nonSystem = messages.filter((message) => message.type !== "system")

  const inFlightIndex = nonSystem.findLastIndex(isInFlight)
  const headCount = Math.floor(scope.historyDepth * scope.headRatio)
  const tailCount = scope.historyDepth - headCount
  const tailStart = Math.max(headCount, nonSystem.length - tailCount)

  // If an in-flight tool interaction sits outside the tail window, expand the window to include it.
  if (inFlightIndex >= 0 && inFlightIndex < tailStart) {
    return [...system, ...nonSystem.slice(inFlightIndex)]
  }

  const head = nonSystem.slice(0, headCount)
  const tail = nonSystem.slice(tailStart)
  return [...system, ...head, ...tail]
}
