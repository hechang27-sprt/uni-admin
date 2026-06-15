import type { Expression, ExpressionBuilder, SqlBool } from "kysely";

import type { Database } from "#server/db/schema";
import type {
  DocumentField,
  DocumentFilter,
  DocumentSort,
  ListDocumentsInput,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";

type DocumentsExpressionBuilder = ExpressionBuilder<Database, "documents">;
type DocumentsBooleanExpression = Expression<SqlBool>;
type DocumentsFieldExpression = Expression<unknown>;

export function normalizeListInput(
  input: ListDocumentsInput = {},
): NormalizedListDocumentsInput {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  return {
    ids: input.ids,
    filter: input.filter,
    sort: normalizeSort(input.sort),
    limit,
    offset,
    includeDeleted: input.includeDeleted ?? false,
    authScopeIds: input.authScopeIds,
    accessibleScopeIds: input.accessibleScopeIds,
  };
}

export function normalizeSort(sort: DocumentSort[] = []): DocumentSort[] {
  const normalized = sort.map((entry) => ({
    ...entry,
    direction: entry.direction ?? "asc",
  }));
  const hasIdTieBreaker = normalized.some(
    (entry) => entry.field.kind === "metadata" && entry.field.name === "id",
  );

  if (!hasIdTieBreaker) {
    normalized.push({
      field: { kind: "metadata", name: "id" },
      direction: "asc",
    });
  }

  return normalized;
}

export function buildFilterCondition(
  eb: DocumentsExpressionBuilder,
  filter: DocumentFilter,
): DocumentsBooleanExpression {
  if ("and" in filter) {
    return eb.and(filter.and.map((child) => buildFilterCondition(eb, child)));
  }

  if ("or" in filter) {
    return eb.or(filter.or.map((child) => buildFilterCondition(eb, child)));
  }

  const field = buildFieldExpression(eb, filter.field);

  switch (filter.op) {
    case "eq": {
      return filter.value === null
        ? eb(field, "is", null)
        : eb(field, "=", filter.value);
    }
    case "ne": {
      return filter.value === null
        ? eb(field, "is not", null)
        : eb(field, "<>", filter.value);
    }
    case "gt": {
      return eb(field, ">", filter.value);
    }
    case "gte": {
      return eb(field, ">=", filter.value);
    }
    case "lt": {
      return eb(field, "<", filter.value);
    }
    case "lte": {
      return eb(field, "<=", filter.value);
    }
  }

  throw new Error("Unsupported filter operation");
}

export function buildAuthScopeCondition(
  eb: DocumentsExpressionBuilder,
  authScopeIds: (string | null)[],
): DocumentsBooleanExpression {
  if (authScopeIds.length === 0) {
    return eb.lit(false);
  }

  const scopedIds = authScopeIds.filter(
    (scopeId): scopeId is string => scopeId !== null,
  );
  const conditions: DocumentsBooleanExpression[] = [];
  if (authScopeIds.includes(null)) {
    conditions.push(eb("documents.authScopeId", "is", null));
  }
  if (scopedIds.length > 0) {
    conditions.push(eb("documents.authScopeId", "in", scopedIds));
  }
  return conditions.length === 1 ? conditions[0]! : eb.or(conditions);
}

export function buildAccessibleScopeCondition(
  eb: DocumentsExpressionBuilder,
  accessibleScopeIds: string[],
): DocumentsBooleanExpression {
  if (accessibleScopeIds.length === 0) {
    return eb.lit(false);
  }

  return eb.and([
    eb("documents.authScopeId", "is not", null),
    eb.exists(
      eb
        .selectFrom("authScopeClosure")
        .select("authScopeClosure.descendantId")
        .whereRef("authScopeClosure.descendantId", "=", "documents.authScopeId")
        .where("authScopeClosure.ancestorId", "in", accessibleScopeIds),
    ),
  ]);
}

export function hasAccessibleScopeFilter(
  accessibleScopeIds: string[] | null | undefined,
): accessibleScopeIds is string[] | null {
  return accessibleScopeIds === null || accessibleScopeIds !== undefined;
}

export function buildFieldExpression(
  eb: DocumentsExpressionBuilder,
  field: DocumentField,
): DocumentsFieldExpression {
  if (field.kind === "data") {
    return eb.fn<string | null>("jsonb_extract_path_text", [
      eb.ref("documents.data"),
      ...field.path.map((segment) => eb.val(segment)),
    ]);
  }

  return eb.ref(`documents.${field.name}`);
}

export function matchesFilter(
  document: StoredDocument,
  filter: DocumentFilter,
): boolean {
  if ("and" in filter) {
    return filter.and.every((child) => matchesFilter(document, child));
  }

  if ("or" in filter) {
    return filter.or.some((child) => matchesFilter(document, child));
  }

  const actual = getFieldValue(document, filter.field);

  switch (filter.op) {
    case "eq": {
      return compareValues(actual, filter.value) === 0;
    }
    case "ne": {
      return compareValues(actual, filter.value) !== 0;
    }
    case "gt": {
      return compareValues(actual, filter.value) > 0;
    }
    case "gte": {
      return compareValues(actual, filter.value) >= 0;
    }
    case "lt": {
      return compareValues(actual, filter.value) < 0;
    }
    case "lte": {
      return compareValues(actual, filter.value) <= 0;
    }
  }

  return false;
}

export function compareDocuments(
  left: StoredDocument,
  right: StoredDocument,
  sort: DocumentSort[],
): number {
  for (const sortEntry of sort) {
    const direction = sortEntry.direction === "desc" ? -1 : 1;
    const comparison = compareValues(
      getFieldValue(left, sortEntry.field),
      getFieldValue(right, sortEntry.field),
    );

    if (comparison !== 0) {
      return comparison * direction;
    }
  }

  return 0;
}

function getFieldValue(
  document: StoredDocument,
  field: DocumentField,
): JsonValue | Date | undefined {
  if (field.kind === "metadata") {
    return document[field.name];
  }

  let current: JsonValue | undefined = document.data;

  for (const segment of field.path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function compareValues(
  left: JsonValue | Date | undefined,
  right: JsonValue | Date | undefined,
): number {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return toComparableText(leftValue).localeCompare(
    toComparableText(rightValue),
  );
}

function toComparableText(value: Exclude<JsonValue, null>): string {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
