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
            capability: sql<string[]>`'["read", "write"]'::jsonb`,
          },
          {
            fn: { capability: "jsonb_array_elements_auto" },
            types: { capability: "text" },
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
            capability: sql<string[]>`'["read", "write"]'::jsonb`,
            roleId: sql<string[]>`'["role-a"]'::jsonb`,
          },
          {
            fn: {
              capability: "jsonb_array_elements_auto",
              roleId: "jsonb_array_elements_auto",
            },
            types: { capability: "text", roleId: "text" },
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

  it("expands JavaScript JSON array values", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            value: [1, 2],
          },
          {
            fn: "jsonb_array_elements_auto",
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([{ value: "1" }, { value: "2" }]);
  });

  it("keeps non-primitive JSON array values as jsonb", async () => {
    const rows = await database
      .selectFrom(
        unnest(
          "input",
          {
            value: [{ key: "one" }, { key: "two" }],
          },
          {
            fn: "jsonb_array_elements_auto",
          },
        ),
      )
      .selectAll()
      .execute();

    expect(rows).toEqual([
      { value: { key: "one" } },
      { value: { key: "two" } },
    ]);
  });
});
