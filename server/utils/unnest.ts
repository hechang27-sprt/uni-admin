import { sql, type AliasedRawBuilder, type Expression } from "kysely";

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
  const groups: FunctionGroup[] = [];

  for (const key of keys) {
    const typedKey = key as keyof T;
    const value = input[key];
    const explicitType = options?.types?.[typedKey];
    const functionName = inferSetReturningFunction(value, explicitType);
    const arg =
      functionName === "unnest"
        ? buildUnnestArg(value, explicitType)
        : buildJsonbArrayElementsCall(functionName, value);
    const previousGroup = groups.at(-1);

    if (previousGroup?.functionName === "unnest" && functionName === "unnest") {
      previousGroup.args.push(arg);
    } else {
      groups.push({ functionName, args: [arg] });
    }
  }

  return groups;
}

function inferSetReturningFunction(
  value: unknown,
  explicitType: string | undefined,
): SetReturningFunction {
  if (!shouldExpandJsonbArray(value, explicitType)) {
    return "unnest";
  }

  return inferJsonbArrayElementsFunction(value, explicitType);
}

function inferJsonbArrayElementsFunction(
  value: unknown,
  explicitType: string | undefined,
): Exclude<SetReturningFunction, "unnest"> {
  const type = parseTypeHint(explicitType);

  if (type && type.base !== "jsonb" && type.base !== "json") {
    return "jsonb_array_elements_text";
  }

  const sample = getJsonArraySample(value);
  return isPrimitiveJsonValue(sample)
    ? "jsonb_array_elements_text"
    : "jsonb_array_elements";
}

function shouldExpandJsonbArray(
  value: unknown,
  explicitType: string | undefined,
): boolean {
  const type = parseTypeHint(explicitType);

  if (type?.array) {
    return false;
  }

  if (isExpression(value)) {
    return type !== undefined;
  }

  if (type && (type.base === "jsonb" || type.base === "json")) {
    return true;
  }

  if (!Array.isArray(value) || type) {
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

function isPrimitiveJsonValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
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

function buildJsonbArrayElementsCall(
  functionName: Exclude<SetReturningFunction, "unnest">,
  value: unknown,
) {
  const jsonbValue = isExpression(value) ? value : normalizeJsonbValue(value);
  return sql`${sql.raw(functionName)}(coalesce(${jsonbValue}::jsonb, ${jsonbArrayFallback()}))`;
}

function arrayFallback(pgType: string) {
  return sql`array[]::${sql.raw(pgType + "[]")}`;
}

function jsonbArrayFallback() {
  return sql`'[]'::jsonb`;
}

function normalizeJsonbValue(value: unknown): string {
  if (typeof value === "string" && isJsonString(value)) {
    return value;
  }
  return JSON.stringify(value ?? []);
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
