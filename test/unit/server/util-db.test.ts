import { describe, expect, it } from "vitest";

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
});
