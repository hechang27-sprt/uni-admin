# Repository And Database

The repository layer is Drizzle-backed. There is no separate in-memory
repository implementation.

## Schema

`server/db/schema.ts` defines:

- `tenantsTable`
- `documentsTable`

Document rows include framework identity, tenant boundary, collection name,
schema version, JSONB projection data, optional remote identity, optimistic
version, timestamps, and soft-delete timestamp.

The remote identity unique index is partial:

```text
(tenant_id, collection, remote_source, remote_id)
where remote_source is not null and remote_id is not null
```

Preserve this distinction between local-only rows and remote-backed rows.

## Repository Implementation

`server/data/documents/repository/drizzle.ts` implements
`DrizzleDocumentRepository`.

Important patterns:

- Scope all document queries by `tenantId` and `collection`.
- Exclude soft-deleted rows unless `includeDeleted` is explicitly true.
- Use `.returning()` and row mappers for writes.
- Keep batch update behavior transactional through `buildBatchUpdateQuery`.
- Preserve input order for `findByIds` and `updateMany`.
- Use `onConflictDoUpdate` for remote projection upserts keyed by remote
  identity.

## Query Normalization

`server/data/documents/repository/query.ts` owns list query normalization and
filter/sort SQL expression building:

- `limit` is clamped to 1..100.
- `offset` is clamped to zero or greater.
- Sort entries default to ascending.
- An `id` metadata tie-breaker is added when callers do not provide one.
- Data filters use JSONB path extraction.
- Metadata filters use the typed metadata field list from `types.ts`.

## Database Utilities

- Runtime `db` is created in `server/util/drizzle.ts` from `DATABASE_URL`.
- Tests use `createInMemoryDb()` from the same file to create a pgLite-backed
  Drizzle database.
- Drizzle Kit config lives in `drizzle.config.ts` and writes migrations under
  `drizzle/`.

## Anti-Patterns

- Do not reintroduce a fake in-memory repository for service tests.
- Do not duplicate query normalization in the service layer.
- Do not build SQL with string concatenation. Use Drizzle expressions and
  `sql` interpolation as in `buildBatchUpdateQuery`.
- Do not update remote projection rows without clearing `deletedAt` when a
  projection is refreshed.
