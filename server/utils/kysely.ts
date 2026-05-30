import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import {
  CamelCasePlugin,
  Kysely,
  PGliteDialect,
  PostgresDialect,
} from "kysely";
import { Pool } from "pg";

import type { Database } from "../db/schema";

export type DatabaseClient = Kysely<Database>;

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
  plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  log(event) {
    if (event.level === "error") {
      console.error("Query failed:", {
        durationMs: event.queryDurationMillis,
        error: event.error,
      });
    }
  },
});

export function createInMemoryDb(): DatabaseClient {
  return new Kysely<Database>({
    dialect: new PGliteDialect({ pglite: new PGlite() }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
    log(event) {
      if (event.level === "error") {
        console.error("Query failed:", {
          durationMs: event.queryDurationMillis,
          error: event.error,
        });
      }
    },
  });
}
