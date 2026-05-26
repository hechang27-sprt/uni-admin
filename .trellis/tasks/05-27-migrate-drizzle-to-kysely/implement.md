# Implementation Plan: Migrate Drizzle Data Layer to Kysely

## Preconditions

- User-approved policy: existing database data and Drizzle migration history
  may be reset.
- Before editing application symbols, read the server specs through
  `trellis-before-dev` and run required GitNexus upstream impact analysis.
- If impact reports HIGH or CRITICAL risk, report it before editing.

## Ordered Checklist

1. Establish Kysely infrastructure and database contract.
   - Install Kysely dependencies/dialect support required by the current
     PostgreSQL and pgLite drivers; remove Drizzle packages only after rewrites
     compile.
   - Replace Drizzle schema inference with typed Kysely table/database
     interfaces, marking UUID/default/timestamp columns as generated.
   - Replace the Drizzle client utility with Kysely production and pgLite test
     database construction.

2. Replace migration ownership from an empty baseline.
   - Add a Kysely migration runner and baseline migration matching all current
     tables, defaults, constraints, indexes, and partial indexes.
   - Update test initialization/teardown to use Kysely migrations and raw
     Kysely SQL.
   - Remove Drizzle Kit config and generated Drizzle migration assets once the
     Kysely baseline is verified.

3. Rewrite the document persistence implementation.
   - Rename/export `KyselyDocumentRepository`.
   - Translate CRUD, list/filter/sort, auth-scope validation, ordered result
     mapping, remote upsert, and transactional atomic batch-update paths.
   - Preserve JSONB behavior, timestamp normalization, tenant scoping,
     soft-deletion behavior, optimistic versions, and order guarantees.
   - Add or adapt an executable test path for Kysely
     `INSERT INTO ... SELECT` that omits generated/default columns.

4. Rewrite auth/RBAC persistence.
   - Rename/export `KyselyAuthRbacRepository`.
   - Translate upsert, transaction, closure-table, requested value-table,
     grant/assignment, access-check, and accessible-scope paths.
   - Preserve all existing auth error selection, tenant membership checks,
     role/scope validation, and result ordering.

5. Update consumers and remove Drizzle artifacts.
   - Update tests, public barrels, examples, and docs from Drizzle concrete
     names/utilities/migration setup to Kysely.
   - Remove `drizzle-orm`, `drizzle-kit`, `drizzle.config.ts`, Drizzle source
     migrations, and remaining Drizzle imports/references that describe live
     implementation behavior.
   - Update `.trellis/spec/server/` repository/testing/auth guidance and
     relevant maintainer documentation.

6. Verify and review affected execution flows.
   - Search for remaining Drizzle runtime/config imports and stale public
     implementation names.
   - Run focused repository tests while translating, then run complete
     validation.
   - Run GitNexus change detection before committing and confirm affected scope
     is limited to persistence, tests, dependencies, and documentation.

## Validation Commands

```bash
rg -n 'drizzle|Drizzle' server test docs .trellis/spec package.json
bun run typecheck
bun run lint
bun run test
```

Where destructive migration assets or renamed public concrete classes are
intentionally documented, inspect any remaining `Drizzle` references rather
than mechanically removing historical explanation.

## Risky Areas And Rollback Points

- Database types/client/migrations: confirm pgLite can build and tear down the
  full baseline before translating repository SQL.
- Document batch mutation SQL: verify ordered success and all-or-nothing stale
  conflict behavior before removing the Drizzle repository.
- Auth/RBAC value-table and closure queries: run auth tests immediately after
  translation; cross-tenant validation must not weaken.
- Dependency/artifact removal: do only after both test suites use Kysely.
- Rollback strategy: revert the code change and recreate the disposable test or
  development database from the prior Drizzle baseline.
