export * as RouterOverride from "./override"

import { eq } from "drizzle-orm"
import { Effect, Option } from "effect"
import { Database } from "../database/database"
import { SessionTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"
import type { RouterTypes } from "./types"

export const OVERRIDE_KEY = "__router_override__"
export const SCOPE_KEY = "__router_scope_override__"

function isScopeType(value: unknown): value is RouterTypes.ContextScope["type"] {
  return value === "minimal" || value === "bounded" || value === "full" || value === "architectural"
}

function readString(value: unknown, key: string): string | undefined {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, key) === "string"
    ? Reflect.get(value, key)
    : undefined
}

function readOverride(value: unknown): RouterTypes.Override | undefined {
  const provider = readString(value, "provider")
  const model = readString(value, "model")
  const scopeTypeRaw = readString(value, "scopeType")
  const scopeType = isScopeType(scopeTypeRaw) ? scopeTypeRaw : undefined
  if (provider || model || scopeType) return { provider, model, scopeType }
  return undefined
}

function getOverride(metadata: Record<string, unknown> | null | undefined): RouterTypes.Override | undefined {
  if (!metadata) return undefined
  const override = metadata[OVERRIDE_KEY]
  const scope = metadata[SCOPE_KEY]
  const scopeType = isScopeType(scope) ? scope : undefined
  const parsed = readOverride(override)
  if (!parsed && !scopeType) return undefined
  if (!parsed) return { scopeType }
  return { provider: parsed.provider, model: parsed.model, scopeType: scopeType ?? parsed.scopeType }
}

export const get = Effect.fn("RouterOverride.get")((sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const row = yield* db
      .select({ metadata: SessionTable.metadata })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    const value = getOverride(row?.metadata ?? undefined)
    return value ? Option.some(value) : Option.none()
  }),
)

export const set = Effect.fn("RouterOverride.set")(
  (input: { readonly sessionID: SessionSchema.ID; readonly override: RouterTypes.Override }) =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const row = yield* db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      const metadata = { ...row?.metadata }
      if (input.override.provider && input.override.model) {
        metadata[OVERRIDE_KEY] = {
          provider: input.override.provider,
          model: input.override.model,
          ...(input.override.scopeType ? { scopeType: input.override.scopeType } : {}),
        }
      } else if (input.override.scopeType) {
        metadata[SCOPE_KEY] = input.override.scopeType
      }
      yield* db.update(SessionTable).set({ metadata }).where(eq(SessionTable.id, input.sessionID)).run()
    }),
)

export const clear = Effect.fn("RouterOverride.clear")((sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const row = yield* db
      .select({ metadata: SessionTable.metadata })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row?.metadata || (row.metadata[OVERRIDE_KEY] === undefined && row.metadata[SCOPE_KEY] === undefined)) return
    const { [OVERRIDE_KEY]: _, [SCOPE_KEY]: __, ...rest } = row.metadata
    yield* db.update(SessionTable).set({ metadata: rest }).where(eq(SessionTable.id, sessionID)).run()
  }),
)
