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
  const recent = messages.slice(-scope.historyDepth)
  return [...system, ...recent]
}
