import { sql, type AliasedRawBuilder, type Expression } from "kysely";
import { match } from "ts-pattern";

type SetReturningFunction =
  | "unnest"
  | "jsonb_array_elements"
  | "jsonb_array_elements_text";
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
  types?: Partial<Record<Extract<keyof T, string>, string>>;
  jsonb?: readonly Extract<keyof T, string>[];
  jsonbText?: readonly Extract<keyof T, string>[];
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
  const functionGroups = buildFunctionGroups(input, keys, options);
  const functionCalls = functionGroups.map((group) => {
    if (group.functionName === "unnest") {
      return sql`unnest(${sql.join(group.args)})`;
    }
    return group.args[0]!;
  });

  let unnestExpr =
    functionCalls.length === 1
      ? sql<Unnested<T, O>>`${functionCalls[0]!}`
      : sql<Unnested<T, O>>`rows from (${sql.join(functionCalls)})`;

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

type FunctionGroup = {
  functionName: SetReturningFunction;
  args: unknown[];
};

function buildFunctionGroups<T extends Record<string, unknown>, O>(
  input: T,
  keys: string[],
  options: UnnestOptions<T, O> | undefined,
): FunctionGroup[] {
  const jsonbKeys = new Set<string>(options?.jsonb);
  const jsonbTextKeys = new Set<string>(options?.jsonbText);

  const groups: FunctionGroup[] = [];

  for (const key of keys) {
    const value = input[key];
    const forceJsonb = jsonbKeys.has(key);
    const forceJsonbText = jsonbTextKeys.has(key);
    const functionName = inferSetReturningFunction(
      value,
      forceJsonb,
      forceJsonbText,
    );

    const arg = match(functionName)
      .with("unnest", () =>
        buildUnnestArg(value, options?.types?.[key as keyof T]),
      )
      .with("jsonb_array_elements_text", () =>
        buildJsonbArrayElementsTextCall(value),
      )
      .with("jsonb_array_elements", () => buildJsonbArrayElementsCall(value))
      .exhaustive();
    const previousGroup = groups.at(-1);

    if (
      previousGroup?.functionName === functionName &&
      functionName === "unnest"
    ) {
      previousGroup.args.push(arg);
    } else {
      groups.push({ functionName, args: [arg] });
    }
  }

  return groups;
}

function inferSetReturningFunction(
  value: unknown,
  forceJsonb: boolean,
  forceJsonbText: boolean,
): SetReturningFunction {
  if (forceJsonbText) {
    return "jsonb_array_elements_text";
  }
  if (forceJsonb || shouldExpandJsonbArray(value)) {
    return "jsonb_array_elements";
  }
  return "unnest";
}

function shouldExpandJsonbArray(value: unknown): boolean {
  if (isExpression(value)) {
    return false;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  const sample = getJsonArraySample(value);
  return Array.isArray(sample) || isPlainObject(sample);
}

function getJsonArraySample(value: unknown): unknown {
  const parsedValue =
    typeof value === "string" && isJsonString(value)
      ? JSON.parse(value)
      : value;

  if (!Array.isArray(parsedValue)) {
    return undefined;
  }

  return parsedValue.find((item) => item !== null && item !== undefined);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function buildUnnestArg(value: unknown, explicitType: string | undefined) {
  const pgType = parseTypeHint(explicitType)?.base;

  if (isExpression(value)) {
    if (pgType) {
      return sql`coalesce(${value}::${sql.raw(pgType + "[]")}, ${arrayFallback(pgType)})`;
    }
    return value;
  }

  const inferredPgType = pgType ?? inferPgType(value);
  const normalizedValue =
    inferredPgType === "jsonb" ? normalizeJsonbArrayElements(value) : value;
  return sql`coalesce(${normalizedValue}::${sql.raw(inferredPgType + "[]")}, ${arrayFallback(inferredPgType)})`;
}

function buildJsonbArrayElementsCall(value: unknown) {
  return sql`jsonb_array_elements(${buildToJsonbArray(value)})`;
}

function buildJsonbArrayElementsTextCall(value: unknown) {
  return sql`jsonb_array_elements_text(${buildToJsonbArray(value)})`;
}

function arrayFallback(pgType: string) {
  return sql`array[]::${sql.raw(pgType + "[]")}`;
}

function jsonbArrayFallback() {
  return sql`'[]'::jsonb`;
}

function buildToJsonbArray(value: unknown) {
  if (isExpression(value)) {
    return sql`coalesce(to_jsonb(${value}), ${jsonbArrayFallback()})`;
  }

  const pgType = inferPgType(value);
  const normalizedValue =
    pgType === "jsonb" ? normalizeJsonbArrayElements(value) : value;

  return sql`to_jsonb(coalesce(${normalizedValue}::${sql.raw(pgType + "[]")}, ${arrayFallback(pgType)}))`;
}

function parseTypeHint(type: string | undefined):
  | {
      base: string;
      array: boolean;
    }
  | undefined {
  if (!type) {
    return undefined;
  }

  const trimmed = type.trim();
  const array = trimmed.endsWith("[]");
  return {
    base: array ? trimmed.slice(0, -2) : trimmed,
    array,
  };
}
