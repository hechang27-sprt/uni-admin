import { sql, type AliasedRawBuilder, type Expression } from "kysely";

// 1. Hardened Type Extraction (Handles readonly arrays and nullable Kysely columns)
type ExtractArrayElement<T> =
  NonNullable<T> extends readonly (infer V)[]
    ? null extends T
      ? V | null // If the array expression was nullable, the unnested element is nullable
      : V
    : T;

type UnwrapType<T> =
  T extends Expression<infer U>
    ? ExtractArrayElement<U>
    : ExtractArrayElement<T>;

export type Unnested<T, O> = {
  [K in keyof T]: UnwrapType<T[K]>;
} & (O extends string
  ? Record<O, number>
  : O extends true
    ? { ordinality: number }
    : Record<never, never>);

export interface UnnestOptions<T, O> {
  fn?: "unnest" | "jsonb_array_elements" | "jsonb_array_elements_text";
  types?: Partial<Record<keyof T, string>>;
  withOrdinality?: O;
}

function inferPgType(val: unknown): string {
  if (Array.isArray(val) && val.length > 0) {
    const item = val.find((v) => v !== null && v !== undefined);

    if (item === undefined) return "text";
    if (Array.isArray(item)) return "jsonb";
    if (typeof item === "string") return "text";
    if (typeof item === "number") return "int";
    if (typeof item === "boolean") return "boolean";
    if (item instanceof Date) return "timestamptz";
    if (typeof item === "object") return "jsonb";
  }
  return "text";
}

// 2. Strict Type Guard: Removed 'any' to ensure TS uses the inferred 'T' securely
function isExpression(val: unknown): val is Expression<unknown> {
  return typeof val === "object" && val !== null && "toOperationNode" in val;
}

function normalizeJsonbArrayElements(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (item === null || item === undefined) {
      return null;
    }
    if (typeof item === "string" && isJsonString(item)) {
      return item;
    }
    return JSON.stringify(item);
  });
}

function isJsonString(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

// 3. The Helper
export function unnest<
  const TName extends string,
  T extends Record<string, unknown>,
  const O extends boolean | string = false,
>(
  as: TName,
  input: T,
  options?: UnnestOptions<T, O>,
): AliasedRawBuilder<Unnested<T, O>, TName> {
  const keys = Object.keys(input);
  const functionName = options?.fn ?? "unnest";
  const typeSuffix = functionName === "unnest" ? "[]" : "";
  const nullFallback =
    functionName === "unnest"
      ? (pgType: string) => sql`array[]::${sql.raw(pgType + typeSuffix)}`
      : () => sql`'[]'::jsonb`;

  if (functionName !== "unnest" && keys.length !== 1) {
    throw new Error(`${functionName} expects exactly one input expression`);
  }

  const args = keys.map((key) => {
    const value = input[key];
    const explicitType = options?.types?.[key];

    if (isExpression(value)) {
      if (explicitType) {
        return sql`coalesce(${value}::${sql.raw(explicitType + typeSuffix)}, ${nullFallback(explicitType)})`;
      }
      if (functionName !== "unnest") {
        return sql`coalesce(${value}::jsonb, ${nullFallback("jsonb")})`;
      }
      return value;
    }

    const pgType = explicitType ?? inferPgType(value);
    const normalizedValue =
      functionName === "unnest" && pgType === "jsonb"
        ? normalizeJsonbArrayElements(value)
        : value;
    return sql`coalesce(${normalizedValue}::${sql.raw(pgType + typeSuffix)}, ${nullFallback(pgType)})`;
  });

  let unnestExpr = sql<Unnested<T, O>>`${sql.raw(functionName)}(${sql.join(args)})`;

  if (options?.withOrdinality) {
    unnestExpr = sql<Unnested<T, O>>`${unnestExpr} with ordinality`;
  }

  const columnIdentifiers = keys.map((key) => sql.id(key));

  if (typeof options?.withOrdinality === "string") {
    columnIdentifiers.push(sql.id(options.withOrdinality));
  } else if (options?.withOrdinality === true) {
    columnIdentifiers.push(sql.id("ordinality"));
  }

  const aliasExpr = sql`${sql.id(as)}(${sql.join(columnIdentifiers)})`;

  return unnestExpr.as<TName>(aliasExpr);
}
