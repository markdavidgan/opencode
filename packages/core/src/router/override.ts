export * as RouterOverride from "./override"

import { eq } from "drizzle-orm"
import { Effect, Option } from "effect"
import { Database } from "../database/database"
import { SessionTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"
import type { RouterTypes } from "./types"

const KEY = "__router_override__"

function isOverride(value: unknown): value is RouterTypes.Override {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).provider === "string" &&
    typeof (value as Record<string, unknown>).model === "string"
  )
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
    const value = row?.metadata?.[KEY]
    return isOverride(value) ? Option.some(value) : Option.none()
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
      const metadata = { ...(row?.metadata ?? {}), [KEY]: input.override }
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
    if (!row?.metadata || row.metadata[KEY] === undefined) return
    const { [KEY]: _, ...rest } = row.metadata
    yield* db.update(SessionTable).set({ metadata: rest }).where(eq(SessionTable.id, sessionID)).run()
  }),
)
