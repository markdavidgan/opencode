export * as RouterClassifier from './classifier'

import { Effect, Schema } from 'effect'
import { LLM, LLMClient, Message } from '@opencode-ai/llm'
import { Catalog } from '../catalog'
import { ConfigRouter } from '../config/router'
import { ModelV2 } from '../model'
import { ProviderV2 } from '../provider'
import { SessionRunnerModel } from '../session/runner/model'
import { RouterTypes } from './types'

export function classifyHeuristic(turn: RouterTypes.UserTurn): RouterTypes.TaskProfile {
  const text = turn.content.toLowerCase()

  if (text.match(/\bfix\b.*\b(typo|spelling|grammar|indent|format)\b/))
    return {
      complexity: 'trivial',
      scope: 'single-file',
      reasoning: 'none',
      codeGenExpected: true,
      toolUseExpected: false,
      longContextExpected: false,
    }

  if (text.match(/\badd\b.*\b(comment|log|print|console)\b/))
    return {
      complexity: 'trivial',
      scope: 'single-file',
      reasoning: 'none',
      codeGenExpected: true,
      toolUseExpected: false,
      longContextExpected: false,
    }

  if (text.match(/\b(refactor|restructure|architect|design|migrate|rewrite)\b/))
    return {
      complexity: 'architectural',
      scope: 'multi-file',
      reasoning: 'recursive',
      codeGenExpected: true,
      toolUseExpected: true,
      longContextExpected: true,
    }

  if (text.match(/\b(plan|strategy|approach|evaluate|compare.*options)\b/))
    return {
      complexity: 'architectural',
      scope: 'system-wide',
      reasoning: 'recursive',
      codeGenExpected: false,
      toolUseExpected: true,
      longContextExpected: true,
    }

  if (text.match(/\b(tests?|spec|unit tests?|coverage)\b/))
    return {
      complexity: 'bounded',
      scope: 'multi-file',
      reasoning: 'linear',
      codeGenExpected: true,
      toolUseExpected: false,
      longContextExpected: false,
    }

  if (text.match(/\b(implement|create|add.*features?|build)\b/))
    return {
      complexity: 'bounded',
      scope: 'multi-file',
      reasoning: 'linear',
      codeGenExpected: true,
      toolUseExpected: true,
      longContextExpected: false,
    }

  return {
    complexity: 'unknown',
    scope: 'unknown',
    reasoning: 'unknown',
    codeGenExpected: true,
    toolUseExpected: true,
    longContextExpected: false,
  }
}

const ClassifierOutput = Schema.Struct({
  complexity: Schema.Literals(['trivial', 'bounded', 'architectural', 'exploratory', 'unknown']),
  scope: Schema.Literals(['single-file', 'multi-file', 'system-wide', 'unknown']),
  reasoning: Schema.Literals(['none', 'linear', 'recursive', 'unknown']),
  codeGenExpected: Schema.Boolean,
  toolUseExpected: Schema.Boolean,
  longContextExpected: Schema.Boolean,
  rationale: Schema.String.pipe(Schema.optional),
})

const DEFAULT_LLM_MODEL = 'openai/gpt-4o-mini'

const SYSTEM_PROMPT = `You are a routing classifier for a coding assistant.
Classify the user request into:
- complexity: trivial, bounded, architectural, exploratory, or unknown
- scope: single-file, multi-file, system-wide, or unknown
- reasoning: none, linear, recursive, or unknown

Also answer booleans: codeGenExpected, toolUseExpected, longContextExpected.

Respond with ONLY valid JSON with keys: complexity, scope, reasoning, codeGenExpected, toolUseExpected, longContextExpected, rationale.`

function parseModelRef(ref: string) {
  const parts = ref.split('/')
  if (parts.length !== 2) return undefined
  return { provider: parts[0], model: parts[1] }
}

function boundedFallback(): RouterTypes.TaskProfile {
  return {
    complexity: 'bounded',
    scope: 'multi-file',
    reasoning: 'linear',
    codeGenExpected: true,
    toolUseExpected: true,
    longContextExpected: false,
  }
}

const classifyWithLlm = Effect.fn('RouterClassifier.classifyWithLlm')((input: { turn: RouterTypes.UserTurn; config: ConfigRouter.Info }) =>
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const llm = yield* LLMClient.Service
    const ref = parseModelRef(input.config.classifier?.llm_model ?? DEFAULT_LLM_MODEL)
    if (!ref) return boundedFallback()

    const catalogModel = yield* catalog.model.get(ProviderV2.ID.make(ref.provider), ModelV2.ID.make(ref.model)).pipe(
      Effect.match({ onFailure: () => undefined, onSuccess: (m) => m }),
    )
    if (!catalogModel) return boundedFallback()

    const model = yield* SessionRunnerModel.fromCatalogModel(catalogModel)
    const response = yield* llm.generate(
      LLM.request({
        model,
        system: SYSTEM_PROMPT,
        messages: [Message.user(input.turn.content)],
      }),
    )

    const text = response.text.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '')
    const parsed = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: (error) => error }).pipe(
      Effect.match({ onFailure: () => undefined, onSuccess: (v) => v }),
    )
    if (!parsed) return boundedFallback()

    const decoded = yield* Schema.decodeUnknownEffect(ClassifierOutput)(parsed).pipe(
      Effect.match({ onFailure: () => undefined, onSuccess: (v) => v }),
    )
    if (!decoded) return boundedFallback()

    return {
      complexity: decoded.complexity,
      scope: decoded.scope,
      reasoning: decoded.reasoning,
      codeGenExpected: decoded.codeGenExpected,
      toolUseExpected: decoded.toolUseExpected,
      longContextExpected: decoded.longContextExpected,
    } satisfies RouterTypes.TaskProfile
  }).pipe(Effect.match({ onFailure: () => boundedFallback(), onSuccess: (profile) => profile })),
)

export const classify = Effect.fn('RouterClassifier.classify')((input: { turn: RouterTypes.UserTurn; config: ConfigRouter.Info }) =>
  Effect.gen(function* () {
    const heuristic = classifyHeuristic(input.turn)
    const strategy = input.config.classifier?.strategy ?? 'hybrid'

    if (strategy === 'heuristic') return heuristic
    if (heuristic.complexity !== 'unknown' && strategy === 'hybrid') return heuristic

    return yield* classifyWithLlm(input)
  }),
)
