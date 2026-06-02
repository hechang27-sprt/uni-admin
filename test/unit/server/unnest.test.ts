import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";

import { createInMemoryDb } from "#server/utils/kysely";
import { unnest } from "#server/utils/unnest";

const database = createInMemoryDb();

afterAll(async () => {
  await database.destroy();
});

describe("unnest", () => {
  it("combines SQL arrays and JSONB array elements with ordinality", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            id: ["first", "second"],
            capability: sql`'["read", "write"]'::jsonb`,
          },
          {
            jsonb: ["capability"],
            withOrdinality: "inputOrder",
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([
      { id: "first", capability: "read", inputOrder: 1 },
      { id: "second", capability: "write", inputOrder: 2 },
    ]);
  });

  it("combines multiple JSONB array element sources", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            capability: sql`'["read", "write"]'::jsonb`,
            roleId: sql`'["role-a"]'::jsonb`,
          },
          {
            jsonb: ["capability", "roleId"],
            withOrdinality: "itemOrder",
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([
      { capability: "read", roleId: "role-a", itemOrder: 1 },
      { capability: "write", roleId: null, itemOrder: 2 },
    ]);
  });

  it("unnests primitive JavaScript arrays as SQL arrays", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            value: [1, 2],
          },
          {
            types: { value: "int" },
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("can force primitive JavaScript arrays to JSONB expansion", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            value: [1, 2],
          },
          {
            jsonb: ["value"],
            types: { value: "text" },
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("keeps non-primitive JSON array values as jsonb", async () => {
    const rows = await database
      .selectFrom(
        unnest("input", {
          value: [{ key: "one" }, { key: "two" }],
        }),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([
      { value: { key: "one" } },
      { value: { key: "two" } },
    ]);
  });

  it("keeps nested JavaScript arrays as JSONB row values", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            id: ["first", "second"],
            value: [["read"], ["write"]],
          },
          {
            withOrdinality: "inputOrder",
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([
      { id: "first", value: ["read"], inputOrder: 1 },
      { id: "second", value: ["write"], inputOrder: 2 },
    ]);
  });
});
