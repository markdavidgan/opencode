import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ConfigRouter } from "@opencode-ai/core/config/router"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { route } from "@opencode-ai/core/router/index"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { RouterAvailability } from "@opencode-ai/core/router/availability"
import { RouterCompactor } from "@opencode-ai/core/router/compactor"
import { RouterCost } from "@opencode-ai/core/router/cost"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)

const it = testEffect(
  Catalog.locationLayer.pipe(
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(locationLayer),
    Layer.provideMerge(Credential.defaultLayer),
  ),
)

function addModel(providerID: string, modelID: string, cost: { input: number; output: number }) {
  return Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    yield* catalog.transform((editor) => {
      editor.provider.update(ProviderV2.ID.make(providerID), (provider) => {
        provider.api = { type: "aisdk", package: "@ai-sdk/openai", settings: {} }
        provider.request.body.apiKey = "test"
      })
      editor.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), (model) => {
        model.cost = [{ input: cost.input, output: cost.output, cache: { read: 0, write: 0 } }]
        model.limit = { context: 1_000_000, output: 100_000 }
        model.capabilities = { tools: true, input: [], output: [] }
      })
    })
  })
}

const routerConfig = new ConfigRouter.Info({
  enabled: true,
  mode: "auto",
  classifier: new ConfigRouter.Classifier({ strategy: "heuristic" }),
  tiers: new ConfigRouter.Tiers({
    trivial: [new ConfigRouter.TierEntry({ provider: "openai", model: "gpt-4o-mini" })],
    bounded: [
      new ConfigRouter.TierEntry({ provider: "anthropic", model: "claude-sonnet-4" }),
      new ConfigRouter.TierEntry({ provider: "openai", model: "gpt-4o" }),
    ],
    architectural: [new ConfigRouter.TierEntry({ provider: "anthropic", model: "claude-opus-4" })],
  }),
})

describe("Router", () => {
  it.effect("routes a trivial prompt to the cheapest trivial-tier model", () =>
    Effect.gen(function* () {
      yield* addModel("openai", "gpt-4o-mini", { input: 0.1, output: 0.4 })
      yield* addModel("openai", "gpt-4o", { input: 5, output: 15 })
      const result = yield* route({
        turn: { content: "fix the typo" },
        messages: [],
        config: routerConfig,
      })
      expect(result.decision.provider).toBe("openai")
      expect(result.decision.model).toBe("gpt-4o-mini")
      expect(result.decision.scope.type).toBe("minimal")
    }),
  )

  it.effect("routes an architectural prompt to the architectural tier", () =>
    Effect.gen(function* () {
      yield* addModel("openai", "gpt-4o-mini", { input: 0.1, output: 0.4 })
      yield* addModel("anthropic", "claude-opus-4", { input: 15, output: 75 })
      const result = yield* route({
        turn: { content: "Design the overall architecture and refactor the codebase" },
        messages: [],
        config: routerConfig,
      })
      expect(result.decision.provider).toBe("anthropic")
      expect(result.decision.model).toBe("claude-opus-4")
      expect(result.decision.scope.type).toBe("full")
    }),
  )

  it.effect("keeps the current model when the price difference is within the sticky threshold", () =>
    Effect.gen(function* () {
      yield* addModel("openai", "gpt-4o-mini", { input: 0.1, output: 0.4 })
      yield* addModel("openai", "gpt-4o", { input: 0.12, output: 0.5 })
      const result = yield* route({
        turn: { content: "What is 2 + 2?" },
        messages: [],
        config: routerConfig,
        currentModel: {
          providerID: ProviderV2.ID.make("openai"),
          id: ModelV2.ID.make("gpt-4o"),
        },
      })
      expect(result.decision.model).toBe("gpt-4o")
    }),
  )

  it.effect("honours a manual provider/model override", () =>
    Effect.gen(function* () {
      yield* addModel("openai", "gpt-4o-mini", { input: 0.1, output: 0.4 })
      yield* addModel("anthropic", "claude-opus-4", { input: 15, output: 75 })
      const result = yield* route({
        turn: { content: "hello" },
        messages: [],
        config: routerConfig,
        override: { provider: "anthropic", model: "claude-opus-4", scopeType: "bounded" },
      })
      expect(result.decision.provider).toBe("anthropic")
      expect(result.decision.model).toBe("claude-opus-4")
      expect(result.decision.scope.type).toBe("bounded")
      expect(result.wasOverridden).toBe(true)
    }),
  )

  it.effect("skips unavailable providers when selecting a model", () =>
    Effect.gen(function* () {
      yield* addModel("openai", "gpt-4o-mini", { input: 0.1, output: 0.4 })
      yield* addModel("anthropic", "claude-sonnet-4", { input: 3, output: 15 })
      RouterAvailability.markUnavailable("openai", routerConfig)
      const result = yield* route({
        turn: { content: "What is 2 + 2?" },
        messages: [],
        config: routerConfig,
      })
      expect(result.decision.provider).toBe("anthropic")
      expect(result.decision.model).toBe("claude-sonnet-4")
    }),
  )

  test("actualCost uses cache rates", () => {
    const model = ModelV2.Info.make({
      id: ModelV2.ID.make("test"),
      providerID: ProviderV2.ID.make("test"),
      name: "test",
      api: { id: ModelV2.ID.make("test"), type: "native", settings: {} },
      capabilities: { tools: true, input: [], output: [] },
      request: { headers: {}, body: {}, generation: {}, options: {} },
      variants: [],
      time: { released: 0 },
      cost: [{ input: 1_000_000, output: 2_000_000, cache: { read: 100_000, write: 500_000 } }],
      status: "active",
      enabled: true,
      limit: { context: 0, output: 0 },
    })
    const cost = RouterCost.actualCost(
      { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 400, cacheWriteInputTokens: 100 },
      model,
    )
    expect(cost).toBeCloseTo(1590, 5)
  })
})

describe("RouterCompactor", () => {
  const now = DateTime.makeUnsafe(0)
  const user = (text: string) => ({
    type: "user" as const,
    id: SessionMessage.ID.create(),
    text,
    files: [],
    agents: [],
    time: { created: now },
  })
  const system = (text: string) => ({
    type: "system" as const,
    id: SessionMessage.ID.create(),
    text,
    time: { created: now },
  })

  test("minimal keeps system messages and the last user turn only", () => {
    const messages = [system("sys"), user("a"), user("b"), user("c")]
    const result = RouterCompactor.compact(messages, {
      type: "minimal",
      includeHistory: false,
      historyDepth: 0,
      headRatio: 0,
      includeFileTree: false,
      includeDecisions: true,
      includeDiff: false,
    })
    expect(result.map((m) => (m.type === "user" || m.type === "system" ? m.text : m.type))).toEqual(["sys", "c"])
  })

  test("bounded keeps the tail of non-system messages", () => {
    const messages = [system("sys"), user("1"), user("2"), user("3"), user("4"), user("5")]
    const result = RouterCompactor.compact(messages, {
      type: "bounded",
      includeHistory: true,
      historyDepth: 3,
      headRatio: 0,
      includeFileTree: false,
      includeDecisions: true,
      includeDiff: false,
    })
    expect(result.map((m) => (m.type === "user" || m.type === "system" ? m.text : m.type))).toEqual(["sys", "3", "4", "5"])
  })

  test("bounded uses headRatio to keep oldest messages in the window", () => {
    const messages = [system("sys"), user("1"), user("2"), user("3"), user("4"), user("5"), user("6")]
    const result = RouterCompactor.compact(messages, {
      type: "bounded",
      includeHistory: true,
      historyDepth: 4,
      headRatio: 0.25,
      includeFileTree: false,
      includeDecisions: true,
      includeDiff: false,
    })
    expect(result.map((m) => (m.type === "user" || m.type === "system" ? m.text : m.type))).toEqual(["sys", "1", "4", "5", "6"])
  })

  test("full and architectural scopes return the whole conversation", () => {
    const messages = [system("sys"), user("1"), user("2")]
    for (const type of ["full", "architectural"] as const) {
      const result = RouterCompactor.compact(messages, {
        type,
        includeHistory: true,
        historyDepth: 0,
        headRatio: 0,
        includeFileTree: true,
        includeDecisions: true,
        includeDiff: true,
      })
      expect(result).toBe(messages)
    }
  })
})
