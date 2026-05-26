import {
  Migrator,
  type Migration,
  type MigrationProvider,
} from "kysely/migration";

import type { DatabaseClient } from "../util/kysely";
import * as baseline from "./migrations/001-baseline";

const migrations: Record<string, Migration> = { "001_baseline": baseline };

const provider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

export async function migrateToLatest(database: DatabaseClient): Promise<void> {
  const migrator = new Migrator({ db: database, provider });
  const { error } = await migrator.migrateToLatest();

  if (error) {
    throw error;
  }
}
