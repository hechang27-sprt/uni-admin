# Local Document Data Layer Implementation Plan

## Checklist

- [ ] Add the runtime validation dependency if it is not already present.
- [ ] Add Vitest and a project test script for data-layer tests.
- [ ] Extend `server/db/schema.ts` with the `documents` table and indexes.
- [ ] Add migration generation/validation notes for Drizzle.
- [ ] Create collection registry types and helpers.
- [ ] Create the server-side document service.
- [ ] Implement tenant-scoped `create`, `getById`, `list`, `update`, `patch`,
      `softDelete`, `restore`, and explicit `hardDelete`.
- [ ] Implement schema validation for create/update/patch.
- [ ] Implement `patch` as an RFC 6902-compatible JSON Patch subset using
      standard operation names and JSON Pointer paths.
- [ ] Support JSON Patch `add`, `replace`, `remove`, and `test`.
- [ ] Defer JSON Patch `move` and `copy`; reject them with a clear unsupported
      operation error.
- [ ] Reject unsupported JSON Patch operations clearly and validate the final
      patched document before persistence.
- [ ] Treat failed JSON Patch `test` as a terminal conflict and include the
      failed path in the normalized error.
- [ ] Implement optimistic concurrency through `version`.
- [ ] Implement single-collection query parsing/building for metadata and JSONB
      path filters, sorting, pagination, and deleted-record inclusion.
- [ ] Add deterministic sort tie breakers and bounded pagination for list
      queries, especially when sorting by JSONB paths.
- [ ] Add focused Vitest coverage for CRUD, tenant isolation, schema
      validation, JSONB query behavior, JSON Patch behavior, soft delete, and
      stale-version failure.
- [ ] Test JSON Patch RFC edge cases: missing target path for `remove` and
      `replace`, array insertion behavior for `add`, and failed `test`
      preconditions.
- [ ] Add thin Nuxt API route examples only if needed to exercise the service.
- [ ] Run format/lint/type-check/build commands available in the repo.

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
