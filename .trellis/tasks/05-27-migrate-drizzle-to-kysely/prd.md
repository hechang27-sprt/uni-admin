# Migrate Drizzle data layer to Kysely

## Goal

Replace the PostgreSQL persistence implementation and migration tooling built
on Drizzle with Kysely so repositories can express set-shaped SQL operations,
including `INSERT INTO ... SELECT`, without working around Drizzle's insert
builder limitations.

## Confirmed Facts

- The application currently depends on `drizzle-orm@^1.0.0-beta.22` and
  `drizzle-kit@^1.0.0-beta.22`, with `pg` for runtime PostgreSQL and
  `@electric-sql/pglite` for integration tests.
- Drizzle owns runtime database construction (`server/util/drizzle.ts`), twelve
  table declarations (`server/db/schema.ts`), and generated migrations under
  `drizzle/`.
- Persistence code consists of `DrizzleDocumentRepository`,
  `DrizzleAuthRbacRepository`, and dynamic filter/sort SQL helpers in
  `server/data/documents/repository/query.ts`.
- Existing repositories contain batch and SQL-shaped behavior that must not
  regress: transactional optimistic updates, CTE/value-table validation,
  upserts, closure-table queries, tenant isolation, and ordered batch results.
- Tests use pgLite, execute Drizzle migrations for each case, and instantiate
  the Drizzle-named repository implementations directly.
- Server specs and maintainer documentation explicitly define Drizzle as the
  current persistence contract.
- Kysely's official documentation provides PostgreSQL and PGlite dialects,
  typed generated columns, migrations, transactions/CTEs, raw SQL escape
  hatches, and `insertInto(...).columns(...).expression(...)` for
  `INSERT INTO ... SELECT`.

## Requirements

- Replace Drizzle runtime query construction and database connections with
  Kysely for PostgreSQL production execution and pgLite-backed tests.
- Replace Drizzle schema model types with a Kysely `Database` type whose
  generated/defaulted columns remain optional for insert operations and whose
  row types preserve current public service contracts.
- Rewrite both repository implementations and document query helpers without
  changing tenant scoping, authorization, batch atomicity, optimistic
  concurrency, soft-delete, remote projection, or returned timestamp behavior.
- Replace Drizzle-backed migration execution and generation/configuration with
  Kysely-managed migrations that create the existing database shape from a
  clean database.
- Remove application/test imports of Drizzle and remove Drizzle dependencies
  and config once no longer required.
- Update repository exports, tests, server specs, and public documentation so
  they describe and exercise the Kysely-backed implementation.
- Treat current databases and Drizzle migration history as disposable: no
  data-preserving conversion or bridge from Drizzle's migration ledger is
  required.

## Acceptance Criteria

- [ ] No server or test runtime code imports `drizzle-orm`, and dependency
      metadata no longer includes `drizzle-orm` or `drizzle-kit`.
- [ ] A Kysely database type and runtime/test construction support both
      PostgreSQL and pgLite, including snake_case database columns and
      camelCase TypeScript repository results.
- [ ] Document repository behavior remains covered for batch create/read/update,
      conflict rollback, list filters/sorts, remote upserts, auth-scope
      validation, deletes, and timestamp mapping.
- [ ] Auth/RBAC repository behavior remains covered for credentials,
      memberships, scope closure, role/permission grants and assignments, and
      document authorization.
- [ ] Migration setup creates the current table, foreign-key, index, partial
      unique-index, and default-value contracts in pgLite tests from an empty
      database; existing Drizzle-managed data may be discarded.
- [ ] Kysely supports the motivating `INSERT INTO ... SELECT` repository path
      without requiring insert values for generated/defaulted columns.
- [ ] `bun run typecheck`, `bun run lint`, and `bun run test` pass after the
      migration.
- [ ] Server specifications and data-layer documentation name Kysely and match
      the implemented persistence contract.

## Out Of Scope

- Changing the user/auth/document domain behavior, database schema semantics,
  public service API, or UI/API routes.
- Introducing a different SQL database engine or a fake repository test layer.
- Supporting an in-place upgrade of existing Drizzle migration history or
  preserving existing database data.

## Decisions

- Existing database data may be reset. The migration begins with a new Kysely
  baseline and does not attempt to import or reconcile Drizzle's migration
  metadata.
- Concrete public implementation names change from `Drizzle*Repository` to
  `Kysely*Repository`; abstract repository/service contracts remain stable.

## Documentation Source

- Kysely official LLM documentation: <https://kysely.dev/llms-full.txt>
