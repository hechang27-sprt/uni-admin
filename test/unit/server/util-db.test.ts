import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pivotToColumns } from "#server/util/db";

describe("server database utilities", () => {
  it("pivots rows and normalizes undefined values to null", () => {
    const columns = pivotToColumns([
      { id: "a", optional: undefined, value: 1 },
      { id: "b", optional: "present", value: undefined },
    ]);

    expect(columns).toEqual({
      id: ["a", "b"],
      optional: [null, "present"],
      value: [1, null],
    });
  });

  it("uses a schema shape to build missing optional columns", () => {
    const rowSchema = z.object({
      id: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable().optional(),
      value: z.number().optional(),
    });

    const columns = pivotToColumns(
      [
        { id: "a" },
        { id: "b", optional: "present", value: undefined },
      ],
      rowSchema,
      "set",
    );

    expect(columns).toEqual({
      id: ["a", "b"],
      setId: [true, true],
      optional: [null, "present"],
      setOptional: [false, true],
      nullable: [null, null],
      setNullable: [false, false],
      value: [null, null],
      setValue: [false, false],
    });
  });

  it("returns empty schema columns for empty input", () => {
    const rowSchema = z.object({
      id: z.string(),
      optional: z.string().optional(),
    });

    expect(pivotToColumns([], rowSchema)).toEqual({
      id: [],
      optional: [],
    });
  });
});
