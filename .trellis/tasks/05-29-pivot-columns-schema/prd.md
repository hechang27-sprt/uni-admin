# Refactor pivot columns to schema shape

## Goal

Refactor `pivotToColumns()` so SQL array column generation is driven by a
runtime schema shape instead of whichever keys happen to appear in input rows.

## Requirements

- `pivotToColumns()` must accept a schema-backed field shape and use it as the
  runtime source of column names.
- Missing optional row fields must produce full-length `null` value columns.
- When a set-prefix is supplied, presence columns such as `setData` must be
  produced for schema fields and use `false` when the original field was not
  present on a row.
- Repository input structures in `server/data/documents/repository/types.ts`
  should expose both Zod schemas and `z.infer`-derived TypeScript types where
  practical.
- Preserve existing repository semantics: batch SQL paths, tenant scoping,
  optimistic update behavior, auth-scope validation, and undefined-to-null SQL
  parameter normalization.
- Keep document payload validation ownership in the service/registry layer; the
  repository schemas describe persistence input shape.

## Acceptance Criteria

- [x] `insertMany`, `updateMany`, and `upsertRemoteProjections` no longer rely
      on data-row keys to discover SQL parameter columns.
- [x] Existing util and server unit tests pass.
- [x] Tests cover schema-driven missing optional columns and prefixed presence
      columns.

## Notes

- Lightweight refactor; PRD-only task.
