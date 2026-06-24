# OpenCode AutoRouter — Implementation Specification

**Status:** Phase 1 complete; this document is the authoritative plan for Phases 2–4.  
**Branch:** `autorouter-phase1`  
**Last updated:** 2026-06-24

---

## 1. Goals and Constraints

The AutoRouter adds an automatic, per-turn model/provider routing layer to OpenCode. It must:

- classify each user turn by complexity/scope/reasoning;
- compact the session context into a scoped brief;
- select the cheapest capable model/provider that is currently available;
- record every decision and actual cost for transparency; and
- allow the user to override routing manually.

**Constraints (non-negotiable):**

- This is a **thin fork**. Modify only the files listed in each phase, plus the new router package.
- Do **not** change the plugin API, auth system, provider adapters, or tool system.
- The router operates on OpenCode’s internal `SessionMessage.Message[]` format; provider adapters translate to the target provider.
- All session history remains durable in SQLite even when a turn uses a scoped brief.

---

## 2. Codebase Reality vs. Original Spec

The original spec assumed a Go repo and paths like `packages/core/src/llm/send.ts`. The actual repo is TypeScript/Bun. Key real paths:

| Original spec path | Actual path |
|---|---|
| `packages/core/src/session/db.ts` | `packages/core/src/session/sql.ts` |
| `packages/core/src/llm/send.ts` | `packages/core/src/session/runner/llm.ts` |
| `packages/cli/src/tui/*` | `packages/tui/src/*` |
| Auth in `~/.local/share/opencode/auth.json` | `Credential` table + `Integration` service |
| Model catalog hardcoded | `Catalog.Service` populated from models.dev + user config |

This spec uses the **actual** paths.

---

## 3. Architectural Decisions

These decisions must be agreed on before continuous implementation starts. Each is followed by the recommended default.

### 3.1 Hook Point

**Decision:** Where does the router intercept the provider turn?

**Recommendation:** In `packages/core/src/session/runner/llm.ts`, inside `runTurnAttempt`, **after** projected history is loaded and **before** model resolution and `LLM.request`.

Current sequence (lines ~170–205):

```ts
const session = yield* getSession(sessionID)
const agent = yield* agents.select(session.agent)
const system = initialized ?? (yield* SessionContextEpoch.prepare(...))
const model = yield* models.resolve(session)              // <- resolve here
const entries = yield* SessionHistory.entriesForRunner(...)
const context = entries.map((entry) => entry.message)
```

New sequence:

```ts
const session = yield* getSession(sessionID)
const agent = yield* agents.select(session.agent)
const system = initialized ?? (yield* SessionContextEpoch.prepare(...))
const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
const context = entries.map((entry) => entry.message)

// ROUTER INTERCEPTION
const turn = { content: lastUserText(context) }
const routerConfig = ConfigRouter.resolve(Config.latest(yield* config.entries(), "router"))
const route = Router.route({ turn, messages: context, config: routerConfig })
// publish decision event + record decision row
const model = yield* resolveRoutedModel(route.decision, session) // replaces models.resolve(session)

const request = LLM.request({
  model,
  system: [agent.info?.system, system.baseline].filter(...),
  messages: toLLMMessages(route.scopedMessages, model),
  ...
})
```

Rationale: this is the only point where we have the full un-compacted context, the latest user turn, and the ability to change the model before any provider work is wasted.

### 3.2 Model Resolution Override

**Decision:** How does the router override the session’s current model?

**Recommendation:** Add a new resolver in `packages/core/src/session/runner/model.ts`:

```ts
resolveFromRef(session: SessionSchema.Info, ref: ModelV2.Ref): Effect.Effect<Model, Error>
```

`resolveRoutedModel` will:

1. Check for a manual override (from `/route`, `--model`, or `routerOverride` metadata).
2. If none, use the route decision’s `provider`/`model` to build a `ModelV2.Ref`.
3. Resolve that ref through the catalog/integrations exactly like `resolve(session)` does today.
4. If resolution fails, apply the configured fallback action.

The session object itself is **not mutated** by the router. Only the local `model` value used for the current turn changes.

### 3.3 Config Reading

**Decision:** How is router config loaded at runtime?

**Recommendation:** In `llm.ts`, yield `Config.Service`, get `entries`, then:

```ts
const routerConfig = ConfigRouter.resolve(Config.latest(entries, "router"))
```

`Config.latest` returns the most specific `router` document (closest `.opencode/` or project file wins). `ConfigRouter.resolve` fills defaults.

For TUI settings (router mode, user overrides), use `useKV()` persistent signals because they are local UI preferences, not project config.

### 3.4 Turn Number

**Decision:** What is the `turn_number` in `router_decisions`?

**Recommendation:** The count of user messages in `context` **before** the current turn is routed. This is intuitive, stable per prompt, and does not require an extra DB query.

```ts
const turnNumber = context.filter((m) => m.type === "user").length
```

### 3.5 Cost Estimation

**Decision:** How are tokens and cost estimated before the turn?

**Recommendation:**

- **Rates:** look up the selected catalog model via `Catalog.Service.model.get(providerID, modelID)`. Use `ModelV2.Info.cost[]` tiers. Rates are USD per 1M tokens.
- **Input tokens:** serialize the scoped brief to a string and estimate through a `TokenEstimator` interface.
  - **OpenAI / o-series:** use `js-tiktoken` (added in Phase 2) with the model-specific encoding.
  - **Anthropic and all others:** use `Math.ceil(text.length / 4) * 1.2` (chars/4 with safety margin) until a dedicated tokenizer is available.
- **Output tokens:** heuristic based on task complexity: trivial 100, bounded 1000, architectural 3000.
- **Estimated cost:** `(inputTokens * inputRate) + (outputTokens * outputRate)`, including cache-read/write rates if known.

For Phase 2, implement the catalog rate lookup, the `TokenEstimator` abstraction, the OpenAI tokenizer, and the fallback estimator.

### 3.6 Actual Cost Recording

**Decision:** How is actual cost recorded after the turn?

**Recommendation:**

1. Add `RouterDecisions.updateActualCost(sessionID, turnNumber, actualCostUsd)` in `packages/core/src/router/decisions.ts`.
2. In `packages/core/src/session/runner/publish-llm-event.ts`, replace the hardcoded `cost: 0` with a real cost computed from `event.usage` and the resolved `ModelV2.Info.cost`.
3. In `packages/core/src/session/runner/llm.ts`, after the stream finishes, call `RouterDecisions.updateActualCost` with the same value.
4. Also update `SessionTable` aggregate cost/tokens by teaching `SessionProjector.applyUsage()` to handle V2 `Step.Ended` events (Phase 2 or 3).

### 3.7 Provider Availability

**Decision:** How does the router know a provider is unavailable?

**Recommendation:** Introduce a small, process-local `ProviderAvailability` service keyed by `ProviderV2.ID`:

- On startup, `catalog.model.available()` and `catalog.provider.available()` already filter out providers without credentials or disabled.
- When a provider returns an auth or rate-limit error, mark it unavailable with exponential backoff: start at 60s, double each consecutive failure, cap at 15 minutes, and add ±25% jitter.
- The selector skips unavailable providers when building the fallback chain.
- This state is intentionally not durable; it is a runtime guard.

### 3.8 Sticky Threshold

**Decision:** When should the router stay on the current model instead of switching?

**Recommendation:** Add to `ConfigRouter.Compaction` (or top-level `RouterConfig`):

```ts
sticky_threshold_usd: Schema.Number.pipe(Schema.optional) // default 0.05
```

If the currently active model is in the selected tier and the estimated savings of switching are below this threshold, keep the current model. This minimizes KV-cache invalidation.

### 3.9 Manual Override

**Decision:** How do `/route`, `/scope`, `--model`, and the TUI interact with the router?

**Recommendation:**

- **`--model` CLI flag:** If set for the session, skip the router entirely for the whole session.
- **`/route <provider>/<model>`:** Sets a transient override for the **next user turn only**.
  - Store it in `session.metadata.routerOverride = { provider, model, singleTurn: true }`.
  - The runner reads it, uses it, then clears `singleTurn`.
  - This avoids adding a new event type for a transient UI action.
- **`/scope <minimal|bounded|full|architectural>`:** Same pattern in `session.metadata.routerScopeOverride`.
- **`/router mode <auto|manual|suggest>`:** Persists in `useKV()` local state; affects TUI behavior.
- **`/router stats` / `/router decisions`:** Read from `router_decisions` table and render in a dialog or sidebar.

When a manual override is present for the current turn, the classifier and selector are skipped. The compactor still runs using the overridden scope (or default scope for the model if no scope override).

### 3.10 Router Modes

**Decision:** What do auto / manual / suggest actually do?

**Recommendation:**

- **`auto`:** Route silently. Status bar shows the decision after it is made.
- **`manual`:** Before `sdk.client.session.prompt(...)` is sent, show `DialogConfirm` with the recommended provider/model/scope/cost. If rejected, do not send.
- **`suggest`:** Show the recommendation in the status bar **before** sending, but still route automatically unless the user types `/route` or `/scope` first.

`Ctrl+R` cycles `auto → manual → suggest → auto` and stores the new mode in `useKV()`.

### 3.11 Communicating Decisions to the TUI

**Decision:** How does the status bar know what was routed?

**Recommendation:**

1. Add a new durable event `SessionEvent.RouterDecided` (schema in `packages/core/src/session/event.ts`).
2. In `llm.ts`, publish it right after `Router.route()` returns.
3. The projector writes/updates the `router_decisions` row.
4. The TUI’s session event stream receives `RouterDecided` and stores the latest decision in local reactive state.
5. `Prompt` renders the indicator from that local state.

This avoids polling the DB and keeps the TUI decoupled from the router internals.

---

## 4. Data Model Additions

### 4.1 `router_decisions` Table (already created in Phase 1)

Existing schema in `packages/core/src/session/sql.ts`:

```ts
id INTEGER PRIMARY KEY AUTOINCREMENT
session_id TEXT NOT NULL
turn_number INTEGER NOT NULL
user_message_preview TEXT
classification_complexity TEXT
classification_scope TEXT
classification_reasoning TEXT
selected_provider TEXT
selected_model TEXT
scope_type TEXT
input_tokens INTEGER
output_tokens INTEGER
estimated_cost_usd REAL
actual_cost_usd REAL
router_reasoning TEXT
time_created INTEGER NOT NULL
```

### 4.2 `SessionEvent.RouterDecided`

Add to `packages/core/src/session/event.ts`:

```ts
export const RouterDecided = Schema.Struct({
  ...Base,
  type: Schema.Literal("router-decided"),
  turnNumber: Schema.Number,
  classificationComplexity: Schema.String,
  classificationScope: Schema.String,
  classificationReasoning: Schema.String,
  selectedProvider: Schema.String,
  selectedModel: Schema.String,
  scopeType: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  estimatedCostUsd: Schema.Number,
  routerReasoning: Schema.String,
})
```

### 4.3 `session.metadata` Override Shape

Use these JSON shapes in `SessionTable.metadata`:

```ts
interface RouterOverride {
  provider: string
  model: string
  singleTurn: boolean
}

interface RouterScopeOverride {
  type: "minimal" | "bounded" | "full" | "architectural"
  singleTurn: boolean
}
```

---

## 5. Router Package API (updated)

```ts
// packages/core/src/router/index.ts
export interface RouteInput {
  readonly turn: RouterTypes.UserTurn
  readonly messages: SessionMessage.Message[]
  readonly config?: ConfigRouter.Info
  readonly currentModel?: ModelV2.Ref
  readonly override?: RouterOverride
}

export interface RouteResult {
  readonly decision: RouterTypes.RouteDecision
  readonly scopedMessages: SessionMessage.Message[]
  readonly wasOverridden: boolean
}

export function route(input: RouteInput): RouteResult
```

`route()`:

1. Resolves config defaults.
2. Applies manual override if present (skip classifier/selector).
3. Classifies the turn.
4. Picks scope from profile + config.
5. Selects cheapest available model from tiers.
6. Applies sticky threshold against `currentModel`.
7. Compacts messages.
8. Returns decision + scoped messages + override flag.

---

## 6. Phase-by-Phase Implementation Plans

### Phase 2: Routing

**Goal:** The router actually intercepts the send pipeline, selects models, records decisions, and exposes TUI controls.

**Core files to modify:**

- `packages/core/src/session/runner/llm.ts`
  - Yield `Config.Service` and `Catalog.Service`.
  - Load full context before model resolution.
  - Call `Router.route()` with turn + messages + config.
  - Publish `SessionEvent.RouterDecided`.
  - Resolve routed model via new `SessionRunnerModel.resolveFromRef`.
  - Pass `route.scopedMessages` to `toLLMMessages`.
  - After streaming, call `RouterDecisions.updateActualCost`.
- `packages/core/src/session/runner/model.ts`
  - Add `resolveFromRef(session, ref)`.
  - Keep `resolve(session)` unchanged.
- `packages/core/src/session/runner/publish-llm-event.ts`
  - Compute real cost from usage + model rates.
  - Emit non-zero `cost` in `SessionEvent.Step.Ended`.
- `packages/core/src/session/event.ts`
  - Add `RouterDecided` event schema.
- `packages/core/src/session/projector.ts`
  - Project `RouterDecided` into `router_decisions`.
  - (Optional) Update `SessionTable` aggregates from V2 `Step.Ended`.

**Router package files to extend:**

- `packages/core/src/router/selector.ts`
  - Consume `Catalog.Service` to enumerate availability.
  - Look up real rates from `ModelV2.Info.cost`.
  - Implement fallback chain.
  - Implement sticky threshold.
- `packages/core/src/router/cost.ts`
  - Add `estimateCost(inputTokens, outputTokens, model)` using cost tiers.
  - Keep fallback estimator for unknown providers.
- `packages/core/src/router/decisions.ts`
  - Add `updateActualCost(...)`.
- `packages/core/src/router/fallback.ts`
  - Add `ProviderAvailability` integration.
  - Define `selectNextDecision` for rate-limit/auth/overflow.

**TUI files to modify:**

- `packages/tui/src/component/prompt/index.tsx`
  - Render router indicator from local decision state.
- `packages/tui/src/routes/session/index.tsx`
  - Add session-scoped slash commands (`/route`, `/scope`, `/router`).
  - Listen for `RouterDecided` events and store latest decision.
- `packages/tui/src/app.tsx`
  - Add global router commands if needed.
- `packages/tui/src/config/keybind.ts`
  - Add `router_mode_cycle: keybind("ctrl+r", ...)`.

**Tests:**

- Unit test `RouterSelector.select` with a mocked catalog.
- Integration test routing a prompt to a specific model using recorded HTTP transport.
- Test `/router mode` cycle and status-bar display.

**Completion criteria:**

- Typo-fix prompts route to the trivial-tier model.
- Refactor prompts route to the architectural-tier model.
- `router_decisions` has a row for every routed turn.
- `actual_cost_usd` is populated after the turn.
- TUI status bar shows routed model/scope/estimate.

---

### Phase 3: Compaction

**Goal:** Implement real context scoping (bounded Head+Tail, tool-result clearing, active decisions, in-flight tool handling).

**Core files to modify:**

- `packages/core/src/router/compactor.ts`
  - Implement `bounded` Head+Tail.
  - Implement tool-result clearing for messages older than `tool_result_clearing_age`.
  - Detect in-flight tool calls and force `full` scope + same provider.
  - Ensure no adjacent assistant turns after filtering.
- `packages/core/src/router/classifier.ts`
  - Add LLM fallback classifier? **No — defer to Phase 4.**
- `packages/core/src/router/index.ts`
  - Add `activeDecisions` to scoped context.

**New file:**

- `packages/core/src/router/decisions-log.ts`
  - Generate a summary of active architectural decisions from session history.

**Tests:**

- Compactor produces correct `minimal` / `bounded` / `full` / `architectural` scopes for sample message arrays.
- In-flight tool call forces full scope.
- Tool-result clearing preserves call records but drops raw output.
- Thrashing detection upgrades scope.

**Completion criteria:**

- `bounded` scope reduces token count measurably vs `full`.
- Switching providers mid-session includes a transition preamble.
- Repeated tool reads of the same file trigger a `full` scope turn.

---

### Phase 4: Intelligence

**Goal:** Add the LLM fallback classifier, sticky model behavior, analytics, and feedback loop.

**Core files to modify:**

- `packages/core/src/router/classifier.ts`
  - Add `classifyLLM(turn, config)` that calls the cheapest configured model.
  - Combine with heuristic using `confidence_threshold`.
- `packages/core/src/router/selector.ts`
  - Use historical accuracy to adjust output-token heuristics.
- `packages/core/src/router/decisions.ts`
  - Add query helpers: cost by model, misclassification rate, switch frequency.
- `packages/core/src/router/fallback.ts`
  - Add user feedback capture (thumbs up/down on routing decisions).

**TUI files:**

- Add feedback UI on assistant messages or in `/router decisions`.
- Add `/router stats` dialog.

**Tests:**

- LLM classifier returns expected profile for ambiguous prompts.
- Sticky threshold reduces switch frequency.
- Decision-log analytics compute correctly.

**Completion criteria:**

- >85% classification accuracy on 100 sample prompts.
- <20% of turns switch models.
- <10% user override rate.
- 30–50% cost reduction vs single-model baseline.

---

## 7. Decisions Locked In

These decisions are now authoritative for Phases 2–4:

1. **Tokenizer dependency:** Add `js-tiktoken` for OpenAI/o-series tokenization in Phase 2. Use a `TokenEstimator` abstraction so Anthropic/other tokenizers can be added later. All other providers use the `chars/4 * 1.2` fallback.
2. **Manual override persistence:** `/route` and `/scope` apply to the **next user turn only**. Persistent model selection continues to use `/models` or the existing model-switch flow.
3. **Sticky threshold default:** `$0.05` USD, configurable via `router.sticky_threshold_usd`.
4. **`manual` mode UX:** Rejection cancels the send and keeps the input, with a hint to use `/route` to override.
5. **Cost currency:** `router.cost_tracking.currency` is display-only. All internal math and DB fields remain USD.
6. **Rate-limit state:** Exponential backoff starting at 60s, doubling each failure, capped at 15 minutes, with ±25% jitter.
7. **Phase 2 test scope:** Runner integration tests plus focused TUI unit tests for command/keybinding wiring. No brittle full-TUI e2e tests.

Implementation proceeds continuously from Phase 2 through Phase 4 on `autorouter-phase1`.
