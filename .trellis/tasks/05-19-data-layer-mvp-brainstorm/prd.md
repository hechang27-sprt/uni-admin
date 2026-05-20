# Data Layer MVP Brainstorm

## Goal

Define the MVP requirements for the data layer of a multi-tenant headless CMS
for rapidly creating admin panels for internal tools. The MVP should replace
the old "new Vue + Spring Boot + initialized database" workflow with a Nuxt-
based framework that stores project-specific business data in PostgreSQL using
a document-oriented JSONB model.

The first planning outcome is a clear, implementation-ready scope for the data
layer only. UI schema, generated admin UI, custom Vue pages, and full product
surface are intentionally deferred until the data model and access interface
are understood.

## User Value

- Framework users can define business entities without creating a new database
  table and backend route for every basic CRUD requirement.
- Framework users get one consistent interface for fetching, mutating, and
  deleting data.
- Framework users can still express more complex project-specific queries when
  business logic grows beyond simple CRUD.
- Multi-tenant storage is built into the foundation instead of added per app.
- Framework users can represent remote backend or microservice tables inside
  the admin framework without making the framework the original source of
  truth for those records.

## Confirmed Facts

- Source request is in `docs/brainstorm.md`.
- The repository is a minimal Nuxt 4 application.
- Current dependencies include Nuxt, Vue, Pinia, Tailwind, Drizzle ORM, `pg`,
  `dotenv`, `drizzle-kit`, `tsx`, oxlint, and Prettier.
- `drizzle.config.ts` targets PostgreSQL and points schema generation at
  `server/db/schema.ts`.
- Existing database schema only defines a `tenants` table with `id` and `name`.
- Existing database utility creates a Drizzle connection from
  `process.env.DATABASE_URL`.
- No data-layer API, document storage schema, validation layer, query layer, or
  migration strategy exists yet.
- Project-specific Trellis frontend specs are still placeholders because the
  bootstrap guideline task remains in progress.
- The current repository is shaped as a Nuxt application, not a published
  library, Nuxt module, layer package, or monorepo workspace.
- Nuxt supports reusable layers that can share partial app structure, server
  code, components, composables, utilities, and config.
- Nuxt supports modules for installing and configuring framework integrations
  inside consuming Nuxt applications.
- Candidate supporting libraries for later evaluation:
  - Zod or similar TypeScript-first runtime schema validation for collection
    schemas and remote response validation.
  - BullMQ for Redis-backed background jobs, retries, and workers if remote sync
    needs retry behavior without a full workflow platform.
  - Temporal TypeScript SDK if remote sync becomes long-running, durable, and
    workflow-heavy enough to justify separate infrastructure.
  - GraphQL Mesh or a custom GraphQL layer for future multi-source or
    multi-collection GraphQL access.
  - PostGraphile or Hasura for generated PostgreSQL GraphQL APIs, though these
    fit relational PostgreSQL exposure better than the framework's custom
    document registry and remote BFF semantics.
  - Electric/Zero-style sync tools for Postgres-to-client/local-first sync,
    though they do not directly solve the remote-system-as-source-of-truth
    write-through BFF case.
- `../s6a_manage` is a concrete source example for the kind of business logic
  this starter template should support:
  - Vue table/form pages call backend controller-specific APIs for task,
    target, executor, department, SMS target, and message workflows.
  - List rows often contain nested projections assembled from multiple backend
    tables, for example task targets with nested task/session data and SMS
    targets with task target/task metadata.
  - Query examples include pagination, fuzzy filters, status filters,
    department/user permission scoping, date/effectivity filters, and computed
    flags such as "has unchecked targets".
  - Business mutations include state transitions (`save`, `submit`, `check`,
    `execute`, `copy`), batch assignment, draft-to-approved promotion,
    deduplicating upserts, stale cleanup, and remote target toggles.
  - Remote/resource operations use explicit workflows, resource locks,
    idempotent starts, and scheduled cleanup in the existing Spring/Temporal
    implementation.

## Requirements

- The MVP must focus on the data layer only.
- Implementation planning is split into two independently verifiable child
  tasks:
  - `05-19-local-document-data-layer`: core local document table, collection
    registry, tenant-scoped CRUD/query, validation, soft delete, and optimistic
    concurrency.
  - `05-19-remote-collection-adapters`: remote-backed BFF collection behavior
    built on top of the local document layer.
- The data layer must support multi-tenancy.
- The data layer must use PostgreSQL as the persistence layer.
- The data layer must support a document-oriented storage approach using JSONB.
- The MVP document boundary is a tenant-scoped generic record grouped by
  collection/document type, backed by a primary JSONB documents table.
- The document/record table must maintain `tenant_id` as explicit metadata even
  if PostgreSQL row-level security is added later.
- MVP data-layer operations must require tenant context and scope all
  collection operations by `tenant_id`.
- PostgreSQL row-level security is compatible with this model, but can be added
  later as an enforcement layer rather than replacing explicit `tenant_id`
  metadata and application-level tenant scoping.
- The data layer must provide a single framework-facing interface for create,
  read, update, delete, and delete-like operations.
- The data layer must keep data schema concerns separate from future UI schema
  concerns.
- The data layer must leave room for custom business logic and non-trivial
  queries, including cases that would previously have been implemented with
  complex SQL joins in Spring Boot + MyBatis.
- JSONB documents must be able to store nested/denormalized projections for
  admin table display, not only flat table-like records.
- The starter template must support custom server-side business actions that
  operate on documents or collections without forcing every action into generic
  CRUD.
- Custom server-side business actions are part of the remote adapter MVP.
- Custom actions may be document-scoped, collection-scoped, or
  workspace/tenant-scoped for explicit multi-collection business logic.
- Custom actions require explicit concurrency guardrails so arbitrary
  collection/workspace operations do not race silently with CRUD or other
  actions.
- Custom actions should use queued operation tracking in MVP so overlapping
  tenant-scoped concurrency scopes are serialized rather than rejected.
- Queued action concurrency scopes should be hierarchical across workspace,
  collection, and document actions.
- Normal CRUD writes should respect active broad action scopes and support
  immediate, queue-on-conflict, and always-queued modes; UI-facing mutations
  should default to queue-on-conflict.
- Queued CRUD writes preserve the caller's expected document version as
  conflict context.
- Queue-on-conflict CRUD writes may defer/re-enqueue while blocked by active
  broad scopes or stale document versions. Other operation failures remain
  non-retryable by default in MVP.
- Stale-version queue-on-conflict retry is replayable by default only for
  patch-style mutations; full-document replacement/update retry requires an
  explicit rebase policy.
- Replayable patch mutations should use an RFC 6902-compatible JSON Patch
  subset with standard operation names and JSON Pointer paths.
- MVP JSON Patch operations are `add`, `replace`, `remove`, and `test`;
  `move` and `copy` are deferred.
- Failed JSON Patch `test` operations are terminal conflicts, not retryable
  stale-version conflicts.
- The MVP operation queue should be PostgreSQL-backed, with Redis/BullMQ
  deferred.
- The MVP operation worker should run in-process by default, with a reusable
  runner that can later be moved to a separate worker process.
- Operation status should be simple and pollable in MVP; progress/log streaming
  is deferred.
- Operation status should expose normalized error codes:
  `CONFLICT_STALE_VERSION`, `CONFLICT_PATCH_TEST_FAILED`,
  `CONFLICT_SCOPE_BLOCKED`, `REMOTE_FAILED`, `REMOTE_TIMEOUT_AMBIGUOUS`,
  `VALIDATION_FAILED`, `UNSUPPORTED_OPERATION`, and `INTERNAL_ERROR`.
- Operation status should expose optional current `wait_reason` values:
  `scope_blocked`, `stale_version_retry`, `scheduled`, and
  `worker_unavailable`.
- API layering should distinguish low-level poll-based operation APIs from
  Nuxt UI-facing async helpers. Low-level APIs can expose applied-vs-queued
  operation handles; UI-facing composables should await queued work internally
  and fit `useAsyncData`, `useFetch`, and event-driven `$fetch` patterns.
- Nuxt UI-facing mutation helpers should use a configurable default wait
  timeout and return pending operation state if queued/running work has not
  completed by then.
- Default Nuxt helper wait timeout is `10_000ms`, configurable globally and per
  call.
- Operation records should track lightweight attempt metadata:
  `attempt_count`, `last_attempt_at`, and `last_error`; full per-attempt
  history/log tables are deferred.
- `queueOnConflict` should use time-based expiry with configurable queued and
  running age thresholds instead of a max attempt-count cap.
- Queued operations should not retry automatically by default in MVP; manual
  re-run creates a new operation.
- Operation cancellation should apply only to queued operations in MVP.
- Stale running operations should become failed-needs-review after timeout
  without automatic retry.
- Queued actions should persist the full `run` response before local
  projection `project` starts.
- Queued action `run_response` values should be JSON-serializable and stored as
  JSONB; large/binary payloads are out of scope.
- Operation records are retained indefinitely by default in MVP; automatic
  cleanup is deferred.
- Custom actions should split remote/business execution from local projection
  writes: `run` performs remote/business work with read-only document access,
  and `project` performs local projection writes through the normal scoped
  document API in the framework-controlled apply phase.
- The MVP common query interface should operate on a single collection at a
  time.
- Multi-collection querying is intentionally deferred. The likely future
  direction is GraphQL queries over the JSONB-backed document store.
- MVP complex joins, reporting, or cross-collection traversal should escape to
  explicit custom server-side code rather than being modeled in the shared data
  interface.
- Some collections may be backed by a remote backend or separate microservice
  where the "real" table lives outside this framework.
- For remote-backed collections, the framework acts as a BFF and maintains a
  local display/projection document that should stay in sync with the remote
  source.
- Remote-backed reads must allow framework users to validate remote responses
  and define custom mapping logic that converts remote payloads into framework
  documents/entities.
- Remote-backed writes initiated by the UI must send the real mutation to the
  remote system first. The local framework document/projection may update only
  after the remote mutation succeeds.
- Remote-backed queued writes/actions should split retry behavior at the remote
  side-effect boundary: queue conflicts before remote execution can defer;
  local projection after persisted remote success can retry; ambiguous remote
  execution is not retried without adapter-declared idempotency.
- MVP remote adapter validation should include a simplified demo fixture based
  on `../s6a_manage` business patterns, with one remote-backed collection,
  explicit sync, one remote-first action, nested projection mapping, and queued
  JSON Patch retry.
- The data layer should support extension points for remote synchronization
  without requiring every MVP collection to be remote-backed.
- MVP remote-backed collections should use a custom per-collection adapter
  interface rather than a general sync framework.
- Remote collection adapters should support remote response validation and
  mapping remote payloads into local framework documents.
- Normal `list` and `getById` operations for remote-backed collections should
  read from the local JSONB projection only.
- Remote-backed collections should expose explicit sync/refresh operations
  that call the adapter, validate the remote response, map it into framework
  documents, and update the local projection.
- Remote-backed writes must remain remote-first: call the remote mutation,
  validate/map the successful response, then update the local projection.
- Long-running or resource-locking business operations should remain outside
  the core CRUD path in MVP, but the design should leave an extension point for
  later workflow engines such as Temporal.
- Framework documents should use an internal UUID primary key regardless of
  whether they are local-only or remote-backed.
- Remote-backed documents should store remote identity separately as
  `remote_source` and `remote_id` metadata.
- Remote identity should be unique per tenant and collection:
  `(tenant_id, collection, remote_source, remote_id)`.
- Collection adapters own how remote identity is extracted from remote payloads.
- Local-only documents leave remote identity metadata empty.
- Zod or a similar TypeScript-first runtime schema validation library is the
  preferred MVP tool for collection schemas and remote response validation.
- BullMQ, Temporal, GraphQL Mesh, generated PostgreSQL GraphQL layers, and
  local-first sync frameworks are deferred until a concrete remote-backed
  collection proves the need.
- Packaging affects schema ownership: an app/template favors local code-defined
  schemas, while a reusable module or runtime-configured CMS may need clearer
  extension points or database-managed metadata.
- MVP consumption should be a starter app/template first.
- The implementation should keep framework-like internals cleanly separated so
  the data layer can later be extracted into a Nuxt module and, if needed, a
  Nuxt layer for reusable UI/app structure.
- Collection schemas should be code-defined for the MVP, aligned with the
  starter-template consumption model, while documents carry enough schema
  version metadata to support future migrations.
- MVP document metadata should include `created_at`, `updated_at`, optional
  `deleted_at`, and a numeric `version`.
- MVP deletes should be soft deletes by default. Standard get/list queries
  should exclude soft-deleted documents unless explicitly requested.
- MVP updates should support optimistic concurrency through the document
  `version`.
- Full audit history, per-field history, and draft/published workflows are
  deferred.
- MVP collection-scoped operations should include `create`, `getById`, `list`,
  `update`, `patch`, `softDelete`, `restore`, and explicit `hardDelete`.
- MVP `patch` should use an RFC 6902-compatible JSON Patch subset, not custom
  mutation operators.
- `hardDelete` should be available only as an intentional privileged/admin
  operation, not the default delete path.
- MVP single-collection query support should include filters on metadata fields
  and JSONB paths, equality/comparison operators, `and`/`or`, sorting,
  pagination, and optional inclusion of soft-deleted records.
- MVP local document storage should include structural indexes for document ID,
  tenant/collection lookup, tenant/collection/deleted filtering, and a general
  GIN index on the JSONB `data` column for flexible document filtering.
- Per-field JSON path indexes are deferred to later collection configuration
  once real high-traffic fields are known.
- Every collection must be explicitly registered in code before use.
- Collection registration must define at minimum the collection name, data
  schema, and schema version.
- Data-layer operations must reject unknown collection names.
- The local document data-layer implementation should add Vitest as the test
  runner so tenant isolation, JSONB query behavior, patch semantics, schema
  validation, soft delete, and stale-version conflicts are covered by automated
  tests instead of build-only checks.

## Acceptance Criteria

- [x] PRD identifies the specific document model and tenant boundary expected
      for the MVP.
- [x] PRD defines the minimum CRUD and query operations the common interface
      must expose.
- [x] PRD defines which advanced query/business-logic cases are supported in
      MVP versus deferred.
- [x] PRD defines schema/versioning expectations for document types.
- [x] PRD defines acceptance tests or validation scenarios for multi-tenant
      isolation, CRUD behavior, and query behavior.
- [ ] If implementation is requested later, complex-task planning artifacts
      include `design.md` and `implement.md` before `task.py start`.
- [ ] Local collection CRUD scenario covers `create`, `getById`, `list`,
      `update`, `patch`, `softDelete`, `restore`, and explicit `hardDelete`.
- [ ] Tenant isolation scenario proves tenant A cannot read or mutate tenant B
      documents, including documents from the same collection.
- [ ] Schema validation scenario proves invalid create/update payloads and
      invalid remote responses are rejected before persistence.
- [ ] Query scenario proves JSONB-path filters, metadata filters, sorting,
      pagination, and deleted-record inclusion behavior.
- [ ] Optimistic concurrency scenario proves stale `version` updates fail.
- [ ] Local document validation scenarios run through Vitest or an equivalent
      project test command, not only through manual scripts.
- [ ] Remote sync scenario proves explicit sync validates and maps remote
      payloads into local projections.
- [ ] Remote write-through scenario proves create/update/delete calls the
      remote adapter first and updates the local projection only after remote
      success.
- [ ] Remote identity scenario proves duplicate remote records are handled
      consistently by `(tenant_id, collection, remote_source, remote_id)`.
- [ ] Custom action scenario proves a registered non-CRUD action can call
      business logic and update local projections only after success.
- [x] Planning is split into local document storage and remote-backed adapter
      child tasks.

## Likely Out of Scope

- Generated admin UI or schema-driven UI rendering.
- Custom Vue page implementation.
- Authentication, user management, RBAC, and permission UI unless needed to
  model data-layer ownership boundaries.
- Replacing every complex SQL/reporting use case in the MVP common interface.
- Full audit/history tables and draft/published content workflows.

## Open Questions

- None for the current parent-level MVP split.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
