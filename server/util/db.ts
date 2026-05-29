/**
 * Pivots an array of objects into an object of arrays.
 * Undefined values are normalized to null for SQL array parameters.
 */
import type { z } from "zod";

type UndefinedToNull<T> = T extends undefined ? null : T;

type GetPrefixedKey<K, Prefix> = Prefix extends string
  ? `${Prefix}${Capitalize<K & string>}`
  : K;

type PivotedValueColumns<T extends Record<string, unknown>> = {
  [K in keyof T]-?: Array<UndefinedToNull<T[K]>>;
};

type PivotedPresenceColumns<
  T extends Record<string, unknown>,
  Prefix,
> = Prefix extends string
  ? {
      [K in keyof T as GetPrefixedKey<K, Prefix>]-?: boolean[];
    }
  : Record<never, never>;

type PivotedColumns<
  T extends Record<string, unknown>,
  Prefix = unknown,
> = PivotedValueColumns<T> & PivotedPresenceColumns<T, Prefix>;

function getPrefixedKey<T extends string, const Prefix extends string>(
  key: T,
  prefix: Prefix,
): GetPrefixedKey<T, Prefix> {
  const prefixed = prefix + key.charAt(0).toUpperCase() + key.slice(1);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Runtime capitalization mirrors the template-literal key type.
  return prefixed as GetPrefixedKey<T, Prefix>;
}

export function pivotToColumns<T extends Record<string, unknown>>(
  array: T[],
): PivotedColumns<T>;

export function pivotToColumns<
  T extends Record<string, unknown>,
  const Prefix extends string,
>(array: T[], prefix: Prefix): PivotedColumns<T, Prefix>;

export function pivotToColumns<
  TSchema extends z.ZodObject,
  const Prefix extends string | undefined,
>(
  array: Array<z.output<TSchema>>,
  schema: TSchema,
  prefix?: Prefix,
): PivotedColumns<z.output<TSchema> & Record<string, unknown>, Prefix>;

export function pivotToColumns(
  array: Record<string, unknown>[],
  schemaOrPrefix?: z.ZodObject | string,
  maybePrefix?: string,
): Record<string, unknown[]> {
  const schema = typeof schemaOrPrefix === "string" ? undefined : schemaOrPrefix;
  const prefix =
    typeof schemaOrPrefix === "string" ? schemaOrPrefix : maybePrefix;
  const result: Record<string, unknown[]> = {};
  const keys = schema
    ? Object.keys(schema.shape)
    : [...new Set(array.flatMap((row) => Object.keys(row)))];

  for (const key of keys) {
    result[key] = [];
    let prefixed: string | undefined;

    if (prefix !== undefined) {
      prefixed = getPrefixedKey(key, prefix);
      result[prefixed] = [];
    }

    for (const row of array) {
      result[key].push(undefinedToNull(row[key]));
      if (prefixed) {
        result[prefixed]!.push(row[key] !== undefined);
      }
    }
  }

  return result;
}

function undefinedToNull<T>(value: T): UndefinedToNull<T> {
  if (value === undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Undefined is intentionally represented as null in SQL-bound column arrays.
    return null as UndefinedToNull<T>;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Non-undefined values retain their original type.
  return value as UndefinedToNull<T>;
}
