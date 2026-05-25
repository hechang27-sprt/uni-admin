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
- Item persistence primitives are batch-only: `insertMany`, `findByIds`,
  `updateMany`, and `hardDeleteMany`. Scalar service methods pass one-item
  arrays and unwrap the result.
- Keep batch update behavior transactional through `buildBatchUpdateQuery`.
- Preserve input order for `findByIds` and `updateMany`.
- Validate all distinct non-null `authScopeId` values for a logical write in
  one tenant-scoped query; reject if any scope is absent.
- Use `onConflictDoUpdate` for remote projection upserts keyed by remote
  identity.

`findByRemoteIdentity` is intentionally singular: a remote reconciliation
operation targets one external identity and it is not used from item loops.

## Scenario: Batch-Only Document Persistence

### 1. Scope / Trigger

- Trigger: adding or changing document creation, identity reads, versioned
  writes, hard deletes, projection upserts, or auth-scope validation.

### 2. Signatures

```ts
interface DocumentRepository {
  insertMany<T>(
    record: InsertManyDocumentsRecord<T>,
  ): Promise<StoredDocument<T>[]>;
  findByIds<T>(input: {
    tenantId: string;
    collection: string;
    ids: string[];
    includeDeleted?: boolean;
  }): Promise<(StoredDocument<T> | null)[]>;
  updateMany<T>(
    record: UpdateManyDocumentsRecord<T>,
  ): Promise<StoredDocument<T>[] | null>;
  hardDeleteMany(input: {
    tenantId: string;
    collection: string;
    ids: string[];
  }): Promise<string[]>;
}
```

### 3. Contracts

- `findByIds` returns positional `null` entries and preserves caller order.
- `updateMany` is atomic and returns `null` when any optimistic update fails.
- One-element calls are the required repository path for scalar service CRUD.
- Batch SQL result mapping must return `Date` instances for document timestamp
  fields; pgLite may return strings from raw `execute()` statements.

### 4. Validation & Error Matrix

- Missing or cross-tenant `authScopeId` in any write item ->
  `DocumentServiceError("INVALID_AUTH_SCOPE")`.
- Version mismatch in any batch mutation ->
  `DocumentServiceError("CONFLICT_STALE_VERSION")` at the service boundary.

### 5. Good/Base/Bad Cases

- Good: validate two distinct scopes once, then insert multiple documents.
- Base: create one document through `insertMany({ items: [item] })`.
- Bad: loop over `items` and issue one scope lookup or update per row.

### 6. Tests Required

- pgLite tests for ordered batch create/read/update, atomic stale update
  rejection, cross-tenant scope rejection, and timestamp return types after
  scalar methods use batch SQL.

### 7. Wrong vs Correct

```ts
// Wrong: database work grows with the item count.
for (const item of items) await repository.update(item);

// Correct: the repository performs one set-shaped optimistic mutation.
await repository.updateMany({ records });
```

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
- Do not reintroduce scalar item insert/read/update/delete repository methods
  or per-scope validation queries.
- Do not update remote projection rows without clearing `deletedAt` when a
  projection is refreshed.
