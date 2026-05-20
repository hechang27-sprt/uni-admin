# Local Document Data Layer Implementation Plan

## Checklist

- [x] Add the runtime validation dependency if it is not already present.
- [x] Add Vitest and a project test script for data-layer tests.
- [x] Extend `server/db/schema.ts` with the `documents` table and indexes.
- [x] Add migration generation/validation notes for Drizzle.
- [x] Create collection registry types and helpers.
- [x] Create the server-side document service.
- [x] Implement tenant-scoped `create`, `getById`, `list`, `update`, `patch`,
      `softDelete`, `restore`, and explicit `hardDelete`.
- [x] Implement schema validation for create/update/patch.
- [x] Implement `patch` as an RFC 6902-compatible JSON Patch subset using
      standard operation names and JSON Pointer paths.
- [x] Support JSON Patch `add`, `replace`, `remove`, and `test`.
- [x] Defer JSON Patch `move` and `copy`; reject them with a clear unsupported
      operation error.
- [x] Reject unsupported JSON Patch operations clearly and validate the final
      patched document before persistence.
- [x] Treat failed JSON Patch `test` as a terminal conflict and include the
      failed path in the normalized error.
- [x] Implement optimistic concurrency through `version`.
- [x] Implement single-collection query parsing/building for metadata and JSONB
      path filters, sorting, pagination, and deleted-record inclusion.
- [x] Add deterministic sort tie breakers and bounded pagination for list
      queries, especially when sorting by JSONB paths.
- [x] Add focused Vitest coverage for CRUD, tenant isolation, schema
      validation, JSONB query behavior, JSON Patch behavior, soft delete, and
      stale-version failure.
- [x] Test JSON Patch RFC edge cases: missing target path for `remove` and
      `replace`, array insertion behavior for `add`, and failed `test`
      preconditions.
- [x] Add thin Nuxt API route examples only if needed to exercise the service.
      Not added in this pass because Vitest covers the server-side service
      boundary directly.
- [x] Run format/lint/type-check/build commands available in the repo.

## Validation Commands

- `bun run test`
- `bun run build`
- Use Drizzle migration/check commands after confirming the repo's intended
  migration workflow.

## Risk Points

- JSONB query builder correctness and SQL injection safety.
- Tenant scoping must be applied centrally in the service, not per caller.
- Patch semantics must be explicit enough to avoid surprising data loss.
- Stale-version updates must fail reliably under concurrent writes.
- GIN index choice may need tuning once real query patterns exist.

## Rollback Points

- Database schema and generated migrations.
- Document query builder.
- Nuxt API route examples, if added.

## Follow-Up Checks Before Start

- None.
