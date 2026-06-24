import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260624081223_add_router_decisions",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`router_decisions\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`session_id\` text NOT NULL,
          \`turn_number\` integer NOT NULL,
          \`user_message_preview\` text,
          \`classification_complexity\` text,
          \`classification_scope\` text,
          \`classification_reasoning\` text,
          \`selected_provider\` text,
          \`selected_model\` text,
          \`scope_type\` text,
          \`input_tokens\` integer,
          \`output_tokens\` integer,
          \`estimated_cost_usd\` real,
          \`actual_cost_usd\` real,
          \`router_reasoning\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_router_decisions_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`router_decisions_session_idx\` ON \`router_decisions\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
