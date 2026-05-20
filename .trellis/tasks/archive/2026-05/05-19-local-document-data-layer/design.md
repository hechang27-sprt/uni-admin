# Local Document Data Layer Design

## Architecture

The local document layer is a server-only TypeScript service that owns document
storage, validation, tenant scoping, lifecycle behavior, and single-collection
querying. Nuxt API routes, remote adapters, and future UI code consume this
service instead of reaching into Drizzle queries directly.

The MVP remains starter-template-first, but internal boundaries should make
later extraction into a Nuxt module practical.

## Storage Model

Use PostgreSQL through Drizzle.

Primary table: `documents`

- `id`: internal UUID primary key.
- `tenant_id`: required foreign key to `tenants.id`, used on every operation.
- `collection`: registered collection name.
- `schema_version`: collection schema version used when the document was
  persisted.
- `data`: JSONB business payload.
- `remote_source`: nullable remote source identifier for later remote-backed
  collections.
- `remote_id`: nullable remote record identifier for later remote-backed
  collections.
- `version`: numeric optimistic-concurrency version.
- `created_at`: timestamp.
- `updated_at`: timestamp.
- `deleted_at`: nullable timestamp for soft delete.

Default indexes:

- Primary key on `id`.
- Lookup index on `(tenant_id, collection)`.
- Default list index on `(tenant_id, collection, deleted_at)`.
- General GIN index on `data`.
- Unique remote identity on `(tenant_id, collection, remote_source, remote_id)`
  where `remote_source` and `remote_id` are present.

Per-field JSON path indexes are deferred to future collection configuration.

Documents may store nested and denormalized projection payloads for admin table
display. This is intentional: source systems like `../s6a_manage` display rows
that combine task, target, session, executor, and status data. The local
document layer should not assume a flat record shape.

The general JSONB GIN index is a flexibility baseline, not a promise that every
JSON path comparison, text search, sort, and pagination pattern is index-backed.
Hot JSON paths may later need expression indexes, generated columns, or
collection-level index configuration once real query patterns are known.

## Collection Registry

Collections are explicitly registered in code. A minimal registration includes:

- `name`
- `schema`
- `schemaVersion`

The schema should be runtime-parseable, preferably Zod. The data layer rejects
unknown collection names and validates create/update/patch payloads before
persistence.

## Service Boundary

Expose a server-side TypeScript service before HTTP routes:

- `create`
- `getById`
- `list`
- `update`
- `patch`
- `softDelete`
- `restore`
- `hardDelete`

Every method accepts tenant context. The service injects tenant filters for all
reads and writes so callers cannot accidentally perform unscoped collection
operations.

Nuxt API routes, if added in MVP, are thin adapters over this service.

## Query Contract

The MVP supports single-collection queries only:

- metadata filters
- JSONB path filters
- equality/comparison operators
- `and` / `or`
- sorting
- pagination
- optional inclusion of soft-deleted records

JSONB path filters and sort paths must support nested projection fields because
admin tables may display and filter values below objects such as `task.name` or
`session.executor`.

JSONB path sorting must use deterministic tie breakers, such as `id` or
`created_at`, so pagination is stable. The MVP query API should enforce
reasonable pagination limits and should not present arbitrary JSONB reporting
queries as cheap or index-backed by default.

Multi-collection querying is deferred. The expected future direction is a
GraphQL layer over the JSONB-backed document store.

## Lifecycle And Concurrency

Deletes are soft deletes by default. Standard `getById` and `list` exclude
soft-deleted documents unless explicitly requested.

Updates use optimistic concurrency through the numeric `version`. A stale
version fails instead of overwriting a newer document.

Patch operations use an RFC 6902-compatible JSON Patch subset for MVP. The
stored patch intent must use standard operation names and JSON Pointer paths.
The service applies the patch to the current document, validates the final
document against the registered collection schema, then writes with optimistic
concurrency. Non-standard operations are avoided unless a concrete business
case proves they are necessary.

The MVP JSON Patch subset supports `add`, `replace`, `remove`, and `test`.
`move` and `copy` are deferred. `test` gives callers a standard field-level
precondition for patch replay; a failed `test` fails the patch attempt rather
than silently rewriting the operation intent.

Patch behavior should preserve the important RFC 6902 edge cases: `remove` and
`replace` fail when the target path does not exist, `add` follows JSON Pointer
and array insertion rules, and `test` compares the current value before later
operations are applied.

A failed `test` is terminal for that patch attempt. It means the caller's
field-level precondition is false on the current document, so the service
returns a normalized conflict error instead of re-enqueueing or mutating the
remaining operations.

Making failed `test` retryable is deferred. It would be a framework-specific
policy layered above RFC 6902 rather than standard JSON Patch behavior, and it
needs a concrete operation that benefits from waiting for a precondition to
become true again.

Local document errors should expose structured error kinds that the remote
adapter queue can map into normalized operation errors:

- stale version -> `CONFLICT_STALE_VERSION`
- failed JSON Patch `test` -> `CONFLICT_PATCH_TEST_FAILED`
- schema validation failure -> `VALIDATION_FAILED`
- unsupported JSON Patch operation -> `UNSUPPORTED_OPERATION`

The local document layer should expose a hook or guard point for broad action
scope checks before writes. The remote adapter/action queue uses this to decide
whether a write can execute immediately, should fail with a typed conflict, or
should be converted into a queued operation for UI-friendly behavior.

Full audit history, per-field history, and draft/published workflows are out
of scope.

## Compatibility

The storage model includes nullable remote identity fields because the remote
adapter child task will build local projections of remote-backed records on
top of the same table.

PostgreSQL row-level security can be added later as an enforcement layer, but
it does not replace explicit `tenant_id` metadata and service-level tenant
scoping.

## Validation Strategy

Add Vitest for the local document data-layer MVP. The service has enough
stateful behavior that `nuxt build` alone is not an adequate correctness check.
Focused tests should cover CRUD, tenant isolation, schema validation, JSONB
query behavior, JSON Patch semantics, soft deletes, and stale-version failures.

Prefer testing the server-side service boundary directly. HTTP route tests are
only needed for any thin Nuxt API adapters added during implementation.
