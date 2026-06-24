export * as RouterDecisions from "./decisions"

import { Effect } from "effect"
import { and, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { RouterDecisionTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"

export interface DecisionInput {
  readonly sessionID: SessionSchema.ID
  readonly turnNumber: number
  readonly userMessagePreview?: string
  readonly classificationComplexity?: string
  readonly classificationScope?: string
  readonly classificationReasoning?: string
  readonly selectedProvider?: string
  readonly selectedModel?: string
  readonly scopeType?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly estimatedCostUsd?: number
  readonly actualCostUsd?: number
  readonly routerReasoning?: string
}

export const record = Effect.fn("RouterDecisions.record")((input: DecisionInput) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(RouterDecisionTable)
      .values({
        session_id: input.sessionID,
        turn_number: input.turnNumber,
        user_message_preview: input.userMessagePreview,
        classification_complexity: input.classificationComplexity,
        classification_scope: input.classificationScope,
        classification_reasoning: input.classificationReasoning,
        selected_provider: input.selectedProvider,
        selected_model: input.selectedModel,
        scope_type: input.scopeType,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        estimated_cost_usd: input.estimatedCostUsd,
        actual_cost_usd: input.actualCostUsd,
        router_reasoning: input.routerReasoning,
      })
      .run()
  }),
)

export const updateActualCost = Effect.fn("RouterDecisions.updateActualCost")(
  (input: { sessionID: SessionSchema.ID; turnNumber: number; actualCostUsd: number }) =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .update(RouterDecisionTable)
        .set({ actual_cost_usd: input.actualCostUsd })
        .where(
          and(
            eq(RouterDecisionTable.session_id, input.sessionID),
            eq(RouterDecisionTable.turn_number, input.turnNumber),
          ),
        )
        .run()
    }),
)
