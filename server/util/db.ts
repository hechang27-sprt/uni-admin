/**
 * Pivots an array of objects into an object of arrays.
 * Undefined values are normalized to null for SQL array parameters.
 */

type UndefinedToNull<T> = T extends undefined ? null : T;

type GetPrefixedKey<K, Prefix> = Prefix extends string
  ? `${Prefix}${Capitalize<K & string>}`
  : K;

type PivotedColumns<T extends Record<string, unknown>, Prefix = unknown> = {
  [K in keyof T | GetPrefixedKey<keyof T, Prefix>]: K extends keyof T
    ? Array<UndefinedToNull<T[K]>>
    : boolean[];
};

function getPrefixedKey<T extends string, const Prefix extends string>(
  key: T,
  prefix: Prefix,
): GetPrefixedKey<T, Prefix> {
  const prefixed = prefix + key.charAt(0).toUpperCase() + key.slice(1);
  return prefixed as GetPrefixedKey<T, Prefix>;
}

export function pivotToColumns<
  T extends Record<string, unknown>,
  const Prefix extends string | undefined,
>(array: T[], prefix = undefined as Prefix): PivotedColumns<T, Prefix> {
  // 1. Initialize as a generic Record so TypeScript allows dynamic mutations
  const result: Record<string, unknown[]> = {};

  if (array.length === 0) {
    // Assert at the boundary
    return result as PivotedColumns<T, Prefix>;
  }

  const keys = [...new Set(array.flatMap((row) => Object.keys(row)))];

  for (const key of keys) {
    result[key] = [];
    let prefixed: string | undefined;

    if (prefix !== undefined) {
      prefixed = getPrefixedKey(key, prefix);
      result[prefixed] = [];
    }

    for (const row of array) {
      // No more TS errors on .push() or assignment!
      result[key].push(undefinedToNull(row[key]));
      if (prefixed) {
        result[prefixed]!.push(row[key] !== undefined);
      }
    }
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Dynamic key initialization preserves each source property's value type.
  return result as PivotedColumns<T, Prefix>;
}

function undefinedToNull<T>(value: T): UndefinedToNull<T> {
  if (value === undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Undefined is intentionally represented as null in SQL-bound column arrays.
    return null as UndefinedToNull<T>;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Non-undefined values retain their original type.
  return value as UndefinedToNull<T>;
}
