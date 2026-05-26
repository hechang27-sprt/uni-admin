# Design: Migrate Drizzle Data Layer to Kysely

## Objective

Replace the Drizzle-specific persistence implementation with Kysely while
preserving document and auth/RBAC behavior. The motivating capability is
type-safe set-shaped SQL, especially `INSERT INTO ... SELECT` where columns
with database defaults are omitted from the insert target.

## Current Boundaries

The migration spans one database boundary with two repository consumers:

- `server/util/drizzle.ts` constructs PostgreSQL and pgLite Drizzle clients.
- `server/db/schema.ts` declares twelve relational tables and their inferred
  types.
- `server/data/documents/repository/drizzle.ts` implements document
  persistence, dynamic filters/sorts, ordered batches, transactional
  optimistic updates, and remote upserts.
- `server/auth/repository.ts` implements user/credential, tenant membership,
  scope closure, role, permission, assignment, and access queries.
- `test/unit/server/service.test.ts` and
  `test/unit/server/auth-rbac.test.ts` execute migrations through pgLite and
  exercise these repositories.

Service and repository interfaces are behavior contracts and do not change.
The concrete Drizzle implementation names are vendor-specific and will be
replaced with Kysely-specific names.

## Target Structure

### Database Types And Clients

- Replace `server/db/schema.ts` with Kysely database table interfaces (or a
  correspondingly named database-types module if keeping `schema.ts` would be
  misleading).
- Model database-generated/defaulted values with Kysely `Generated` /
  `ColumnType` so generated UUIDs, versions, and timestamps are optional in
  inserts but correctly typed in selected rows.
- Model the Kysely `Database` contract in camelCase and configure
  `CamelCasePlugin({ maintainNestedObjectKeys: true })` so structured queries
  target physical `snake_case` identifiers and return the existing camelCase
  repository/domain rows without rewriting JSONB document payload keys.
- Raw SQL fragments and the baseline migration continue to spell physical
  `snake_case` identifiers explicitly because plugin identifier transforms do
  not rewrite SQL text.
- Replace `server/util/drizzle.ts` with a Kysely database utility exporting the
  runtime PostgreSQL database and pgLite test constructor. Use Kysely's
  PostgreSQL and PGlite dialect support over the existing drivers.

### Migrations

- Remove Drizzle Kit configuration and the `drizzle/` migration source.
- Establish one Kysely baseline migration for an empty database that creates
  the existing tables, defaults, foreign keys, indexes, and partial unique
  indexes.
- Supply a small migration runner usable by pgLite tests and by runtime/CLI
  migration execution. No bridge migration or Drizzle ledger compatibility is
  required because existing data may be reset.
- Keep the schema semantics unchanged: migration format changes, not domain
  storage.

### Repository Implementations

- Rename and rewrite `DrizzleDocumentRepository` as
  `KyselyDocumentRepository`; keep `DocumentRepository` method signatures and
  observable results unchanged.
- Rename and rewrite `DrizzleAuthRbacRepository` as
  `KyselyAuthRbacRepository`; keep `AuthRbacRepository` and
  `AuthRbacService` contracts unchanged.
- Rewrite `server/data/documents/repository/query.ts` to produce Kysely
  expressions for JSONB filtering, metadata filtering, and ordering.
- Continue using structured Kysely builders where they express the operation
  directly. Use Kysely's parameterized `sql` fragments for PostgreSQL-specific
  value tables, JSONB paths, partial-conflict predicates, closure/access SQL,
  and the atomic batch update CTE.
- Implement set-shaped insert-select operations using
  `.insertInto(...).columns(...).expression(...)`, omitting generated/default
  columns from `.columns(...)`.

### Data Flow And Contracts

The database-to-service data flow remains:

```text
Kysely query row -> repository row mapper -> StoredDocument / auth model -> service
```

- Tenant and collection constraints remain in every document query.
- `authScopeId: null` remains tenant-root/global metadata, not public access.
- `findByIds`, `updateMany`, authorization checks, and remote projections
  preserve caller order.
- `updateMany` remains atomic: any missing or stale row rolls back the
  transaction and returns `null`.
- pgLite string timestamps produced by raw query paths continue to be
  normalized to `Date`.

## Compatibility And API Changes

- The database schema remains semantically compatible, but migration history
  and existing rows are intentionally discarded.
- Public concrete implementation exports change:
  `DrizzleDocumentRepository` -> `KyselyDocumentRepository` and
  `DrizzleAuthRbacRepository` -> `KyselyAuthRbacRepository`.
- Public service interfaces, errors, collection registration, authorization
  semantics, and document payload types do not change.
- Documentation and server specs will be revised in the same change because
  they currently prescribe Drizzle names and migration commands.

## Alternatives Considered

- Keep Drizzle for schema/migrations and use Kysely only for difficult queries:
  rejected because the request is to remove the Drizzle limitation from the
  codebase, and a dual query stack leaves duplicate database type ownership.
- Preserve existing Drizzle migration history with a handoff migration:
  rejected by scope decision; existing data may be reset.
- Avoid automatic camel/snake-case transformation entirely: rejected because
  it adds repetitive mapping for ordinary structured queries. Raw
  PostgreSQL-specific SQL remains explicit, while `maintainNestedObjectKeys`
  preserves JSON document data at the plugin boundary.

## Risk And Rollback

- Highest behavioral risk is translating batch/authorization SQL while
  retaining tenant isolation, transactional semantics, and result order.
- Highest operational risk is the destructive migration baseline; it is
  accepted for this task and must be documented plainly.
- Before application edits, GitNexus impact analysis is required for every
  modified class/function/method, with HIGH/CRITICAL results reported before
  proceeding.
- Rollback is source-level: revert to Drizzle code and recreate the disposable
  database from the prior Drizzle migrations.

## Source

- Official Kysely documentation: <https://kysely.dev/llms-full.txt>
