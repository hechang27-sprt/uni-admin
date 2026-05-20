# Local Document Data Layer

## Goal

Build the core tenant-scoped JSONB document data layer for the starter-template
MVP. This task owns the local PostgreSQL storage model, collection registry,
schema validation, CRUD/query interface, soft delete, and optimistic
concurrency. Remote-backed collection behavior is intentionally owned by the
remote adapter child task.

## Requirements

- Use PostgreSQL as the persistence layer.
- Store framework documents in a primary JSONB-backed table.
- Use tenant-scoped generic records grouped by collection/document type.
- Keep `tenant_id` as explicit document metadata even if PostgreSQL row-level
  security is added later.
- `documents.tenant_id` must be a real foreign key to `tenants.id`.
- Require tenant context for every framework data operation.
- Automatically scope all collection operations by `tenant_id`.
- Keep framework document IDs as internal UUIDs.
- Require explicit code registration for every collection before use.
- Collection registration must define at minimum collection name, data schema,
  and schema version.
- Reject unknown collection names.
- Use code-defined schemas for MVP, preferably Zod or a similar
  TypeScript-first runtime schema validation library.
- Persist schema version metadata on documents to support future migrations.
- Expose collection-scoped `create`, `getById`, `list`, `update`, `patch`,
  `softDelete`, `restore`, and explicit `hardDelete` operations.
- Implement `patch` with an RFC 6902-compatible JSON Patch subset for MVP,
  rather than framework-specific mutation operators.
- MVP JSON Patch operations are `add`, `replace`, `remove`, and `test`;
  `move` and `copy` are deferred.
- A failed JSON Patch `test` operation is a terminal patch conflict, not a
  retryable stale-version conflict.
- Local document service errors should map cleanly to the shared normalized
  operation error codes, especially `CONFLICT_STALE_VERSION`,
  `CONFLICT_PATCH_TEST_FAILED`, `VALIDATION_FAILED`, and
  `UNSUPPORTED_OPERATION`.
- Make `hardDelete` an intentional privileged/admin operation, not the default
  delete behavior.
- Include document metadata for `created_at`, `updated_at`, optional
  `deleted_at`, and numeric `version`.
- Exclude soft-deleted documents from default `getById` and `list` results
  unless explicitly requested.
- Enforce optimistic concurrency on updates using document `version`.
- Support single-collection queries only.
- Query support must include filters on metadata fields and JSONB paths,
  equality/comparison operators, `and`/`or`, sorting, pagination, and optional
  inclusion of soft-deleted records.
- JSONB query support is a functional MVP contract, not a guarantee that every
  arbitrary JSONB path comparison or sort is index-backed by the general GIN
  index.
- List/query results must use deterministic sort tie breakers and bounded
  pagination.
- Include default structural indexes for document ID, tenant/collection lookup,
  tenant/collection/deleted filtering, and a general GIN index on the JSONB
  `data` column.
- Defer per-field JSON path indexes to later collection configuration once real
  high-traffic fields are known.
- Defer multi-collection querying. The likely future direction is GraphQL over
  the JSONB-backed document store.
- Defer full audit history, per-field history, and draft/published workflows.
- Keep framework-like internals separated enough that the data layer can later
  be extracted from the starter template into a Nuxt module.
- Build the core data layer as a server-side TypeScript service API first.
- Nuxt API routes should be built as a thin layer on top of the server-side
  service, not as the primary business/data access implementation.
- Add Vitest as the MVP test runner for focused service/query/concurrency
  coverage, since the repository currently has no test script.

## Acceptance Criteria

- [ ] Database schema defines the local document storage model with explicit
      tenant, collection, JSONB data, schema version, lifecycle metadata, and
      optimistic concurrency metadata.
- [ ] `documents.tenant_id` references `tenants.id`.
- [ ] Database schema includes structural tenant/collection/deleted indexes and
      a general GIN index on JSONB `data`.
- [ ] Collection registry rejects unknown collections and exposes registered
      schemas/configuration to the data layer.
- [ ] Create/update/patch operations validate payloads before persistence.
- [ ] Patch operations accept only the chosen RFC 6902-compatible subset and
      validate the final document before persistence.
- [ ] Patch operations support `add`, `replace`, `remove`, and `test`, and
      reject `move`/`copy` with a clear unsupported-operation error.
- [ ] Patch tests cover RFC edge cases for missing `remove`/`replace` targets,
      array `add` behavior, and failed `test` preconditions.
- [ ] Failed JSON Patch `test` operations fail the patch with a normalized
      terminal conflict error.
- [ ] CRUD scenario covers `create`, `getById`, `list`, `update`, `patch`,
      `softDelete`, `restore`, and explicit `hardDelete`.
- [ ] Tenant isolation scenario proves tenant A cannot read or mutate tenant B
      documents, including documents from the same collection.
- [ ] Query scenario proves JSONB-path filters, metadata filters, sorting,
      pagination, and deleted-record inclusion behavior.
- [ ] Query scenario proves deterministic ordering and pagination bounds.
- [ ] Optimistic concurrency scenario proves stale `version` updates fail.
- [ ] Default reads exclude soft-deleted documents unless explicitly requested.
- [ ] Core document operations are available through a server-side TypeScript
      service API.
- [ ] Any Nuxt API routes added for MVP delegate to the server-side service and
      do not duplicate data-layer logic.
- [ ] Vitest test coverage proves CRUD, tenant isolation, schema validation,
      JSONB query behavior, JSON Patch behavior, soft-delete behavior, and
      stale-version failures.
- [ ] `package.json` exposes a project test command that runs the local
      document data-layer tests.
- [ ] Complex-task planning has `design.md` and `implement.md` before this task
      is started.

## Out of Scope

- Remote-backed collection adapters and remote synchronization behavior.
- Generated admin UI or UI schema rendering.
- GraphQL query layer.
- Authentication, RBAC, and permission UI.
- PostgreSQL row-level security policy implementation.
- Full audit/history tables and draft/published workflows.

## Notes

- Parent planning task: `05-19-data-layer-mvp-brainstorm`.
- This task should be implemented before `05-19-remote-collection-adapters`
  because the remote adapter layer depends on the local document projection
  API.
