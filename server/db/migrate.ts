import { promises as fs } from "node:fs";
import path from "node:path";

import { FileMigrationProvider, Migrator } from "kysely/migration";

import type { DatabaseClient } from "../utils/kysely";

export async function migrateToLatest(database: DatabaseClient): Promise<void> {
  const migrator = new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dirname, "migrations"),
    }),
  });
  const { error } = await migrator.migrateToLatest();

  if (error) {
    throw error;
  }
}
