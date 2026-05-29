# Repository And Database

The repository layer is Kysely-backed. There is no separate in-memory
repository implementation.

## Schema

`server/db/schema.ts` defines the typed Kysely `Database` shape, including:

- `tenants`
- `documents`

Document rows include framework identity, tenant boundary, collection name,
schema version, JSONB projection data, optional remote identity, optimistic
version, timestamps, and soft-delete timestamp.

The remote identity unique index is partial:

```text
(tenant_id, collection, remote_source, remote_id)
where remote_source is not null and remote_id is not null
```

Preserve this distinction between local-only rows and remote-backed rows.

## Scenario: Kysely Client And Baseline Migration Boundary

### 1. Scope / Trigger

- Trigger: changing database clients, migrations, table interfaces, casing
  conversion, or JSONB persistence behavior.

### 2. Signatures

```ts
type DatabaseClient = Kysely<Database>;
function createInMemoryDb(): DatabaseClient;
function migrateToLatest(database: DatabaseClient): Promise<void>;
```

### 3. Contracts

- The TypeScript `Database` contract uses camelCase table and column names.
- Both PostgreSQL and pgLite clients configure
  `CamelCasePlugin({ maintainNestedObjectKeys: true })`.
- Physical database identifiers remain snake_case; migrations and raw SQL
  fragments use those physical names explicitly.
- `maintainNestedObjectKeys: true` is required because `documents.data` is
  application JSON and keys such as `external_ref` must not be renamed.
- The Kysely baseline targets an empty database. Existing Drizzle migration
  history and data are not upgraded in place.

### 4. Validation & Error Matrix

- Migration failure -> `migrateToLatest()` rejects before tests seed data.
- Omitting `maintainNestedObjectKeys: true` -> document JSON keys can be
  silently camel-cased on reads, violating the stored payload contract.

### 5. Good/Base/Bad Cases

- Good: builders refer to `authScopeId` and the plugin targets
  `auth_scope_id`; a document `data.external_ref` is returned unchanged.
- Base: tests create a pgLite Kysely database, migrate it, then seed tenants.
- Bad: write raw SQL with camelCase physical columns or use the default
  `CamelCasePlugin` mapping for JSONB document rows.

### 6. Tests Required

- pgLite migration from an empty database followed by document/auth behavior
  suites.
- An assertion that snake_case JSON data keys round-trip unchanged through
  repository reads.

### 7. Wrong vs Correct

```ts
// Wrong: maps plain JSON result objects recursively.
plugins: [new CamelCasePlugin()]

// Correct: transforms row identifiers without altering document JSON.
plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })]
```

## Repository Implementation

`server/data/documents/repository/kysely.ts` implements
`KyselyDocumentRepository`.

Important patterns:

- Scope all document queries by `tenantId` and `collection`.
- Exclude soft-deleted rows unless `includeDeleted` is explicitly true.
- Use `.returning()` and row mappers for writes.
- Item persistence primitives are batch-only: `insertMany`, `findByIds`,
  `updateMany`, and `hardDeleteMany`. Scalar service methods pass one-item
  arrays and unwrap the result.
- Keep batch update behavior transactional through `buildBatchUpdateQuery`.
- Preserve input order for `findByIds` and `updateMany`.
- Gate `insertMany`, `updateMany`, and `upsertRemoteProjections` mutations
  through a statement-local invalid-scope CTE so successful scoped writes
  validate and mutate in one database call. On rejected writes, an ordered
  validation lookup may run to preserve `INVALID_AUTH_SCOPE` details.
- Correlate ordered read, delete, and upsert output through SQL input
  relations with ordinality rather than building `Map` or `Set` instances
  from query results.
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
- Mixed valid and invalid scoped write batches are atomic: no valid item is
  persisted when any requested `authScopeId` is invalid.
- One-element calls are the required repository path for scalar service CRUD.
- Batch SQL result mapping must return `Date` instances for document timestamp
  fields; pgLite may return strings from raw `execute()` statements.

### 4. Validation & Error Matrix

- Missing or cross-tenant `authScopeId` in any write item ->
  `DocumentServiceError("INVALID_AUTH_SCOPE")`.
- Version mismatch in any batch mutation ->
  `DocumentServiceError("CONFLICT_STALE_VERSION")` at the service boundary.

### 5. Good/Base/Bad Cases

- Good: gate a multi-row insert with one invalid-scope CTE and insert only
  when every requested scope belongs to the tenant.
- Base: create one document through `insertMany({ items: [item] })`.
- Bad: loop over `items` and issue one scope lookup or update per row.

### 6. Tests Required

- pgLite tests for ordered batch create/read/update, atomic stale update
  rejection, cross-tenant scope rejection without partial writes, and
  timestamp return types after scalar methods use batch SQL.

### 7. Wrong vs Correct

```ts
// Wrong: successful writes pay a separate validation round trip.
await assertAuthScopesBelongToTenant(db, tenantId, scopeIds);
await db.insertInto("documents").values(items).execute();

// Wrong: database work grows with the item count.
for (const item of items) await repository.update(item);

// Correct: SQL gates and performs one set-shaped optimistic mutation.
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

- Runtime `db` is created in `server/util/kysely.ts` from `DATABASE_URL`.
- Tests use `createInMemoryDb()` from the same file to create a pgLite-backed
  Kysely database.
- `pivotToColumns()` in `server/util/db.ts` is the shared row-to-column helper
  for SQL array parameters and normalizes `undefined` values to `null`.
- For repository batch inputs with optional fields, pass the matching Zod
  object schema to `pivotToColumns()` so column names come from the declared
  input shape rather than from whichever row keys happen to exist. This is
  required for full-length `null` value columns and prefixed `setX` boolean
  columns when every row omits an optional field.
- Structured queries use `CamelCasePlugin({ maintainNestedObjectKeys: true })`
  to map camelCase TypeScript identifiers to snake_case SQL without changing
  JSONB document payload keys.
- `server/db/migrate.ts` runs the Kysely baseline migration from
  `server/db/migrations/` for empty databases.

## Anti-Patterns

- Do not reintroduce a fake in-memory repository for service tests.
- Do not duplicate query normalization in the service layer.
- Do not build SQL with string concatenation. Use Kysely builders and `sql`
  interpolation as in `buildBatchUpdateQuery`.
- Do not reintroduce scalar item insert/read/update/delete repository methods
  or per-scope validation queries.
- Do not update remote projection rows without clearing `deletedAt` when a
  projection is refreshed.
- Do not discover batch SQL parameter columns only from the first row or from
  observed row keys when the input type has optional fields; use the schema
  shape.
