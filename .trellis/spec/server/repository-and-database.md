# Repository And Database

The repository layer is Kysely-backed. There is no separate in-memory
repository implementation.

## Schema

`server/db/schema.ts` defines the typed Kysely `Database` shape, including:

- `tenants`
- `apps`
- `tenantApps`
- `collections`
- `documents`

Document rows include tenant boundary, structured app and collection ids,
schema version, JSONB projection data, optional remote identity, optimistic
version, timestamps, and soft-delete timestamp.

The remote identity unique index is partial:

```text
(tenant_id, app_id, collection_id, remote_source, remote_id)
where remote_source is not null and remote_id is not null
```

Preserve this distinction between local-only rows and remote-backed rows. Do not
scope document persistence by the structured `collection` string alone.

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
- `permissions.resource_scope` stores collection-derived auth target mode when
  present: `document`, `tenant-root`, or `none`.
- `SYSTEM_TENANT_ID` and `BOTTOM_SCOPE_ID` are the all-zero UUID. The baseline
  migration seeds a system tenant row plus a physical bottom scope row.
- `user_role_assignments.scope_id` is non-nullable and always references
  `auth_scopes.scope_id`; explicit bottom grants store `BOTTOM_SCOPE_ID`.
- Assignment uniqueness is a single concrete-scope unique index on
  `(tenant_id, user_id, role_id, scope_id)`.

### 4. Validation & Error Matrix

- Migration failure -> `migrateToLatest()` rejects before tests seed data.
- Omitting `maintainNestedObjectKeys: true` -> document JSON keys can be
  silently camel-cased on reads, violating the stored payload contract.
- Writing a bottom-scope assignment without the partial unique index split ->
  duplicate `scope_id is null` grants can persist silently because PostgreSQL
  treats nulls as distinct in ordinary unique indexes.

### 5. Good/Base/Bad Cases

- Good: builders refer to `authScopeId` and the plugin targets
  `auth_scope_id`; a document `data.external_ref` is returned unchanged.
- Base: tests create a pgLite Kysely database, migrate it, then seed tenants.
- Bad: write raw SQL with camelCase physical columns or use the default
  `CamelCasePlugin` mapping for JSONB document rows.
- Good: collection permission sync persists `permissions.resource_scope` from
  registry auth metadata, and bottom-scope role assignments store
  `scope_id = BOTTOM_SCOPE_ID` through the same FK path as other scopes.
- Bad: normalize bottom to tenant root, reintroduce `scope_id = null`, or rely
  on split partial unique indexes for bottom-vs-scoped grants.

### 6. Tests Required

- pgLite migration from an empty database followed by document/auth behavior
  suites.
- An assertion that snake_case JSON data keys round-trip unchanged through
  repository reads.
- Migration/auth coverage proving `permissions.resource_scope`, the seeded
  system/bottom scope rows, closure-to-bottom maintenance, and concrete-scope
  uniqueness for bottom-scope grants.

### 7. Wrong vs Correct

```ts
// Wrong: maps plain JSON result objects recursively.
plugins: [new CamelCasePlugin()];

// Correct: transforms row identifiers without altering document JSON.
plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })];
```

## Scenario: Catalog-Scoped Document Persistence

### 1. Scope / Trigger

- Trigger: changing app registration, collection registration, tenant app
  enablement, document persistence identity, or remote projection uniqueness.

### 2. Signatures

```ts
interface CatalogRepository {
  ensureApps(input: EnsureCatalogAppInput[]): Promise<Record<string, CatalogApp>>;
  findApp(key: string): Promise<CatalogApp | null>;
  enableTenantApps(input: EnableTenantAppInput[]): Promise<void>;
  syncCollections(registry: CollectionRegistry): Promise<CatalogCollection[]>;
  findCollection(input: FindCatalogCollectionInput): Promise<CatalogCollection | null>;
  findTenantCollection(
    input: FindTenantCatalogCollectionInput,
  ): Promise<CatalogCollection | null>;
}

type CollectionSchema<TData extends JsonObject = JsonObject> =
  z.ZodObject<z.ZodRawShape> & z.ZodType<TData>;

type CollectionRegistration<TSchema extends CollectionSchema = CollectionSchema> =
  z.input<ReturnType<typeof collectionRegistrationSchema<TSchema>>>;

type RegisteredCollection<TSchema extends CollectionSchema = CollectionSchema> =
  z.output<ReturnType<typeof registeredCollectionSchema<TSchema>>>;
// RegisteredCollection is branded by Zod after defaults are derived.
```

### 3. Contracts

- `appKey` defaults to `default`; `key` defaults from `name` for compatibility; `name` defaults from `key` and is descriptive metadata.
- `definitionKey` defaults to normalized public `key`, not descriptive `name`.
- Registry uniqueness is `(appKey, key)`, so two apps may define `tasks`, and one app may use a descriptive name distinct from its public key.
- `apps.key` is unique.
- `tenant_apps` is keyed by `(tenant_id, app_id)`.
- `collections` is unique on `(app_id, key)` and `(app_id, collection_id)`.
- `documents.app_id` and `documents.collection_id` are the persisted document
  identity within a tenant/app boundary; there is no mirrored persisted
  `documents.collection` column.
- The document service requires registered collections to be synced into the
  catalog and the tenant app to be enabled before document persistence. The
  default app can be bootstrapped through `CatalogService.enableTenantApp`, but
  document operations do not implicitly enable tenant apps.
- Default-app bootstrap is the only normal path that creates apps implicitly.
  Non-default tenant enablement must target an existing app key.

### 4. Validation & Error Matrix

- Missing registered collection -> `DocumentServiceError("UNKNOWN_COLLECTION")`.
- Registered app not enabled for tenant ->
  `DocumentServiceError("UNKNOWN_COLLECTION")`, including the default app.
- Enabling a tenant app for an unknown app key ->
  `DocumentServiceError("NOT_FOUND")`.
- Cross-app same collection name -> valid when callers provide the intended
  `appKey`.
- Remote identity duplicate in the same tenant/app/collection -> upsert/update
  the existing projection; same remote id in another app or collection is valid.

### 5. Good/Base/Bad Cases

- Good: `DocumentService` resolves `{ tenantId, appKey, collection }` to
  `CatalogCollection` and passes `appId + collectionId` into the repository.
- Base: default-app callers omit `appKey`; the service still resolves the
  default app and persists by structured ids.
- Bad: repository code reads or writes documents filtered only by
  `tenantId + collection` instead of `tenantId + appId + collectionId`.

### 6. Tests Required

- pgLite migration creates app/catalog tables and constraints.
- Tenant without an enabled non-default app cannot write documents for that app.
- Two apps can both define `tasks` without document or remote-upsert
  cross-contamination.

### 7. Wrong vs Correct

```ts
// Wrong: collection string is not sufficient identity after catalog migration.
await repository.list({ tenantId, collection: "tasks", query });

// Correct: service resolves catalog identity before persistence.
const identity = await catalog.findTenantCollectionIdentity({
  tenantId,
  appKey: collection.appKey,
  collectionKey: collection.key,
});
await repository.list({
  tenantId,
  appId: identity.appId,
  collectionId: identity.collectionId,
  query,
});
```

## Repository Implementation

`server/data/documents/repository/kysely.ts` implements
`KyselyDocumentRepository`.

`server/auth/um/repository.ts` implements `KyselyAuthRbacRepository`.
Auth/RBAC repository methods expose database facts and set-shaped SQL helpers:
active membership lookup, tenant-bound user/role/assignment/scope/document id
validation, permission-key validation, capability checks, and delegated role
permission denial lookup.
Keep omnibus authorization policy in `AuthRbacService.evaluateAccess`; do not
reintroduce a repository-level `checkAccessMany` policy method.
Repository classes that implement interfaces are `@injectable()` concrete
classes, but the interfaces themselves are not injectable. Bind and inject them
through `SERVER_DI_TYPES.AuthRbacRepository` and
`SERVER_DI_TYPES.DocumentRepository`.

Important patterns:

- Scope all document queries by `tenantId`, `appId`, and `collectionId`.
- Keep `collection` only as a public service input for registry/catalog
  resolution and validation.
- Use `.returning()` and row mappers for writes.
- Item persistence primitives are batch-oriented where mutation semantics need
  them: `insertMany`, `updateMany`, `upsertRemoteProjections`, and
  `hardDeleteMany`. Local reads use `list` with filters instead of a positional
  repository `findByIds` helper.
- Do not perform auth-scope tenant validation in
  `KyselyDocumentRepository`. Document service methods validate non-null
  `authScopeId` values through the configured `AuthRbacService` before
  calling repository write methods.
- Correlate ordered write/delete/upsert output through SQL input relations with
  ordinality rather than building `Map` or `Set` instances from query results.
  Callers that need ordered read results derive them from `list` output.
- Prefer Kysely query/expression builders for repository query structure,
  joins, `exists` checks, and CTE composition. Keep `sql` fragments narrowly
  scoped to primitives Kysely cannot express cleanly, such as typed
  `unnest(...::uuid[])` input relations, casts, and small computed expressions.
- For `unnest()` input relations, alias the raw source directly with
  `.as<"input">(...)`. Do not wrap it in a nested `selectFrom` callback just
  to call `.selectAll().as("input")`; the direct alias is shorter and keeps
  Kysely's table alias typing intact.
- Use the shared `unnest()` helper when a repository input relation needs to
  combine SQL arrays with JSONB array expansion. `types` hints describe the
  produced scalar column type for normal SQL-array unnesting only. Nested
  JavaScript array/object elements and columns listed in `jsonb` expand through
  `jsonb_array_elements(to_jsonb(...))`, ignore matching `types` hints, and
  produce JSONB columns. The helper emits `ROWS FROM(...)` when multiple
  set-returning functions must align by ordinality.
- Use `onConflictDoUpdate` for remote projection upserts keyed by remote
  identity.
- `selectGrantedPermissions()` now expands every assignment through
  `auth_scope_closure`; bottom-scope assignments participate by storing
  `BOTTOM_SCOPE_ID`, which has its own self-closure row.
- Repository capability evaluation must keep tenant-root and bottom distinct:
  tenant-root callers pass the concrete tenant root scope id, while
  bottom-target callers pass `BOTTOM_SCOPE_ID`.
- Document-service translation now persists explicit root/bottom document scope
  ids and passes direct grant rows plus `resourceScope` into repository list
  filtering; there is no deferred document-null compatibility path in this
  cutover.

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
  list<T>(input: {
    tenantId: string;
    appId: string;
    collectionId: string;
    query?: ListDocumentsInput;
  }): Promise<StoredDocument<T>[]>;
  updateMany<T>(
    record: UpdateManyDocumentsRecord<T>,
  ): Promise<StoredDocument<T>[] | null>;
  hardDeleteMany(input: {
    tenantId: string;
    appId: string;
    collectionId: string;
    ids: string[];
  }): Promise<string[]>;
}
```

### 3. Contracts

- `list` returns the matching document set for the normalized query; callers
  derive positional `null` entries or custom ordering from `items` when needed.
- `updateMany` is atomic and returns `null` when any optimistic update fails.
- Mixed valid and invalid scoped write batches are rejected by the service
  before repository persistence: no valid item is persisted when any requested
  `authScopeId` is invalid.
- One-element calls are the required repository path for scalar service CRUD.
- Batch SQL result mapping must return `Date` instances for document timestamp
  fields; pgLite may return strings from raw `execute()` statements.

### 4. Validation & Error Matrix

- Missing or cross-tenant `authScopeId` in any write item ->
  `DocumentServiceError("INVALID_AUTH_SCOPE")`.
- Version mismatch in any batch mutation ->
  `DocumentServiceError("CONFLICT_STALE_VERSION")` at the service boundary.

### 5. Good/Base/Bad Cases

- Good: service validates every requested non-null `authScopeId` before
  calling the repository for a multi-row insert.
- Base: create one document through `insertMany({ items: [item] })`.
- Bad: loop over `items` and issue one scope lookup or update per row.

### 6. Tests Required

- pgLite tests for batch create/list/update behavior, atomic stale update
  rejection, cross-tenant scope rejection without partial writes, and
  timestamp return types after scalar methods use batch SQL.

### 7. Wrong vs Correct

```ts
// Wrong: repository write method owns auth-scope validity policy.
await repository.assertAuthScopesBelongToTenant(tenantId, scopeIds);
await repository.insertMany({ tenantId, appId, collectionId, schemaVersion, items });

// Wrong: hides a composable repository query inside one raw SQL statement.
await sql`with input as (...) select exists (...)`.execute(db);

// Wrong: wraps a plain unnest source in an unnecessary subquery.
await db.selectFrom(({ selectFrom }) =>
  selectFrom(sql<{ id: string }>`unnest(${ids}::uuid[])`.as(sql`t(id)`))
    .selectAll()
    .as("input"),
);

// Wrong: database work grows with the item count.
for (const item of items) await repository.update(item);

// Correct: SQL gates and performs one set-shaped optimistic mutation.
await repository.updateMany({ records });

// Correct: builder owns the query; raw SQL is only the typed input relation.
await db
  .with("input", (db) =>
    db
      .selectFrom(
        sql<{ id: string }>`unnest(${ids}::uuid[])`.as<"input">(sql`input(id)`),
      )
      .selectAll(),
  )
  .selectFrom("input")
  .innerJoin("documents", "documents.id", "input.id")
  .select("documents.id")
  .execute();
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

- Runtime `db` is created in `server/utils/kysely.ts` from `DATABASE_URL`.
- Tests use `createInMemoryDb()` from the same file to create a pgLite-backed
  Kysely database.
- Repository code under `server/` may rely on Nuxt server auto-imports from
  `server/utils/` for shared utility symbols such as `DatabaseClient`,
  `pivotToColumns()`, and `unnest()`. Follow the existing module convention:
  do not add explicit `#server/utils/*` imports inside server-only modules
  unless the file is outside Nuxt's server auto-import scope or a tool requires
  an explicit import.
- `pivotToColumns()` in `server/utils/pivot.ts` is the shared row-to-column
  helper for SQL array parameters and normalizes `undefined` values to `null`.
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
- Do not write whole repository queries as raw SQL when Kysely can express the
  CTEs, joins, filters, and boolean conditions. Whole-statement raw SQL loses
  typed table references and makes casing/alias mistakes easier to miss.
- Do not reintroduce scalar item insert/read/update/delete repository methods
  or per-scope validation queries.
- Do not update remote projection rows without clearing `deletedAt` when a
  projection is refreshed.
- Do not discover batch SQL parameter columns only from the first row or from
  observed row keys when the input type has optional fields; use the schema
  shape.
