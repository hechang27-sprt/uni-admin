import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { JsonObject } from "../data/documents/types";

export const tenantsTable = pgTable("tenants", {
  id: uuid().primaryKey().defaultRandom(),
  name: text(),
});

export const documentsTable = pgTable(
  "documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    collection: text().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    data: jsonb().$type<JsonObject>().notNull(),
    remoteSource: text("remote_source"),
    remoteId: text("remote_id"),
    version: integer().notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_tenant_collection_idx").on(
      table.tenantId,
      table.collection,
    ),
    index("documents_tenant_collection_deleted_idx").on(
      table.tenantId,
      table.collection,
      table.deletedAt,
    ),
    index("documents_data_gin_idx").using("gin", table.data),
    uniqueIndex("documents_remote_identity_unique")
      .on(table.tenantId, table.collection, table.remoteSource, table.remoteId)
      .where(
        sql`${table.remoteSource} is not null and ${table.remoteId} is not null`,
      ),
  ],
);
