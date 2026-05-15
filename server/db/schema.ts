import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: uuid().primaryKey().defaultRandom(),
  name: text(),
});
