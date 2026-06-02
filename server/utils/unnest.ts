import { sql, type AliasedRawBuilder, type Expression } from "kysely";

type UnnestFunction =
  | "unnest"
  | "jsonb_array_elements"
  | "jsonb_array_elements_text"
  | "jsonb_array_elements_auto";

type ResolvedUnnestFunction = Exclude<
  UnnestFunction,
  "jsonb_array_elements_auto"
>;

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
  fn?: UnnestFunction | Partial<Record<keyof T, UnnestFunction>>;
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
    if (group.fn === "unnest") {
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
  fn: ResolvedUnnestFunction;
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
    const functionName = getFunctionName(
      typedKey,
      value,
      explicitType,
      options,
    );
    const arg =
      functionName === "unnest"
        ? buildUnnestArg(value, explicitType)
        : buildJsonbArrayElementsCall(functionName, value);
    const previousGroup = groups.at(-1);

    if (previousGroup?.fn === "unnest" && functionName === "unnest") {
      previousGroup.args.push(arg);
    } else {
      groups.push({ fn: functionName, args: [arg] });
    }
  }

  return groups;
}

function getFunctionName<T, O>(
  key: keyof T,
  value: unknown,
  explicitType: string | undefined,
  options: UnnestOptions<T, O> | undefined,
): ResolvedUnnestFunction {
  const configuredFunction = options?.fn;

  if (configuredFunction === undefined) {
    return "unnest";
  }

  const functionName =
    typeof configuredFunction === "string"
      ? configuredFunction
      : (configuredFunction[key] ?? "unnest");

  if (functionName === "jsonb_array_elements_auto") {
    return inferJsonbArrayElementsFunction(value, explicitType);
  }

  return functionName;
}

function inferJsonbArrayElementsFunction(
  value: unknown,
  explicitType: string | undefined,
): Exclude<ResolvedUnnestFunction, "unnest"> {
  if (explicitType && explicitType !== "jsonb" && explicitType !== "json") {
    return "jsonb_array_elements_text";
  }

  const sample = getJsonArraySample(value);
  return isPrimitiveJsonValue(sample)
    ? "jsonb_array_elements_text"
    : "jsonb_array_elements";
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
  if (isExpression(value)) {
    if (explicitType) {
      return sql`coalesce(${value}::${sql.raw(explicitType + "[]")}, ${arrayFallback(explicitType)})`;
    }
    return value;
  }

  const pgType = explicitType ?? inferPgType(value);
  const normalizedValue =
    pgType === "jsonb" ? normalizeJsonbArrayElements(value) : value;
  return sql`coalesce(${normalizedValue}::${sql.raw(pgType + "[]")}, ${arrayFallback(pgType)})`;
}

function buildJsonbArrayElementsCall(
  functionName: Exclude<ResolvedUnnestFunction, "unnest">,
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
