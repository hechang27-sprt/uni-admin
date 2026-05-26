import { sql, type RawBuilder } from "kysely";

import type {
  DocumentField,
  DocumentFilter,
  DocumentSort,
  JsonValue,
  ListDocumentsInput,
  NormalizedListDocumentsInput,
  StoredDocument,
} from "../types";

export function normalizeListInput(
  input: ListDocumentsInput = {},
): NormalizedListDocumentsInput {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  return {
    filter: input.filter,
    sort: normalizeSort(input.sort),
    limit,
    offset,
    includeDeleted: input.includeDeleted ?? false,
    authScopeIds: input.authScopeIds,
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
  filter: DocumentFilter,
): RawBuilder<boolean> {
  if ("and" in filter) {
    const children = filter.and.map((child) => buildFilterCondition(child));
    return sql<boolean>`(${sql.join(children, sql` and `)})`;
  }

  if ("or" in filter) {
    const children = filter.or.map((child) => buildFilterCondition(child));
    return sql<boolean>`(${sql.join(children, sql` or `)})`;
  }

  const field = buildFieldExpression(filter.field);

  switch (filter.op) {
    case "eq": {
      return filter.value === null
        ? sql<boolean>`${field} is null`
        : sql<boolean>`${field} = ${filter.value}`;
    }
    case "ne": {
      return filter.value === null
        ? sql<boolean>`${field} is not null`
        : sql<boolean>`${field} <> ${filter.value}`;
    }
    case "gt": {
      return sql<boolean>`${field} > ${filter.value}`;
    }
    case "gte": {
      return sql<boolean>`${field} >= ${filter.value}`;
    }
    case "lt": {
      return sql<boolean>`${field} < ${filter.value}`;
    }
    case "lte": {
      return sql<boolean>`${field} <= ${filter.value}`;
    }
  }

  throw new Error("Unsupported filter operation");
}

export function buildFieldExpression(
  field: DocumentField,
): RawBuilder<unknown> {
  if (field.kind === "data") {
    return sql`jsonb_extract_path_text(${sql.ref("documents.data")}, ${sql.join(
      field.path.map((segment) => sql`${segment}`),
      sql`, `,
    )})`;
  }

  return sql.ref(`documents.${field.name}`);
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
