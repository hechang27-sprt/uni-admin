# Remote Collection Adapters

## Goal

Build explicit per-collection adapters for remote-backed collections. These
adapters let the Nuxt starter-template framework act as a BFF for records whose
real source of truth lives in a separate backend or microservice, while keeping
local JSONB documents as display/query projections.

## Requirements

- Build on the local document data layer from
  `05-19-local-document-data-layer`.
- Allow each registered collection to be local-only or remote-backed.
- Use a custom per-collection remote adapter interface rather than a general
  sync framework.
- Remote collection adapters should support remote response validation and
  mapping remote payloads into local framework documents.
- Zod or a similar TypeScript-first runtime schema validation library is the
  preferred MVP tool for remote response validation.
- Normal `list` and `getById` operations for remote-backed collections should
  read from the local JSONB projection only.
- Remote-backed collections should expose explicit sync/refresh operations that
  call the adapter, validate remote responses, map payloads into framework
  documents, and update the local projection.
- Remote-backed writes initiated by the UI must call the real remote mutation
  first.
- Local projection updates may happen only after the remote mutation succeeds.
- Remote-backed queued writes and actions should distinguish retry boundaries:
  conflicts before the remote call can defer/re-enqueue; after remote success,
  local projection apply can retry from the persisted successful response; but
  remote failures or ambiguous remote timeouts must not be auto-retried unless
  the adapter declares a stable idempotency key.
- Remote adapters should expose explicit idempotency metadata or an
  idempotency-key hook for remote calls when an adapter wants future automatic
  remote retry eligibility.
- Remote adapters must be able to map remote responses into nested or
  denormalized local projection documents for admin table display.
- Remote adapters must support custom server-side actions that are not generic
  CRUD, such as submit/check/execute/copy/toggle-style operations from
  `../s6a_manage`.
- Custom actions may update local projections only after the underlying remote
  action succeeds.
- Custom actions are part of the remote adapter MVP, not a separate later task.
- Custom actions should be user-defined server-side code split into a `run`
  phase and an optional `project` phase. `run` can read local context and call
  remote/business logic. `project` runs afterward with writable scoped document
  API access to update local projections.
- Custom actions must support multiple scopes: document-scoped actions for a
  single row/document, collection-scoped actions for a whole collection or
  selected set, and workspace/tenant-scoped actions for explicit
  multi-collection business logic.
- Custom actions should not receive raw database access by default. Projection
  writes should use the normal scoped document API during the framework-
  controlled `project` phase so tenant scoping, schema validation, soft-delete
  behavior, and optimistic concurrency rules are preserved.
- Cross-collection custom actions are allowed, but they do not change the MVP
  generic query interface, which remains single-collection.
- Custom actions must have an explicit concurrency model. Single-document
  changes use document `version`; multi-document `project` writes run in short
  controlled transactions; collection/workspace actions should declare a
  tenant-scoped concurrency scope.
- Normal CRUD writes should support configurable conflict behavior:
  `immediate`, `queueOnConflict`, or `queued`.
- UI-facing mutating routes should default to `queueOnConflict`, converting a
  write into an operation record when a broad workspace/collection scope is
  active.
- Queued CRUD update/patch/delete/restore operations should preserve the
  caller's original expected document version as conflict context.
- `queueOnConflict` should keep deferring/re-enqueueing CRUD writes while the
  blocker is an active broad concurrency scope or a stale document version.
  Stale-version conflicts are retryable for `queueOnConflict`; other operation
  failures remain non-retryable by default.
- Stale-version retry should be replayable by default only for patch-style
  mutations. Full-document replacement/update operations should require an
  explicit rebase policy before retrying against a newer document version.
- Replayable patch mutations should use the local document layer's RFC
  6902-compatible JSON Patch subset. Custom/non-standard patch operators are
  out of scope unless a concrete need appears.
- Replayable patch mutations can use `add`, `replace`, `remove`, and `test`.
  `move` and `copy` are deferred for MVP.
- Failed `test` operations during queued patch retry are terminal conflicts,
  not retryable stale-version conflicts.
- For remote-backed queued CRUD/actions, stale-version retry applies to the
  local projection phase after remote success when the projection is
  patch-style or derived from the persisted remote success response. The remote
  `run`/mutation itself is not retried after ambiguous execution without
  adapter-declared idempotency.
- Server-side callers may use `immediate` mode to receive typed conflicts
  instead of queuing.
- PostgreSQL `SERIALIZABLE` should not be the primary concurrency mechanism;
  use explicit document versions, short transactions, and scope serialization.
- Queue workers should claim operation rows using PostgreSQL row locking with
  `FOR UPDATE SKIP LOCKED` or equivalent Drizzle-supported SQL.
- Concurrency scopes should be hierarchical: workspace actions block all
  tenant actions, collection actions block that collection and its document
  actions, and document actions block only the same document unless a broader
  scope is running.
- MVP custom actions should use queued operation tracking so overlapping
  tenant-scoped concurrency scopes are serialized rather than rejected.
- MVP operation queue should be PostgreSQL-backed using operation records, not
  BullMQ/Redis.
- MVP should default to an in-process worker inside the Nuxt server.
- The in-process worker is the local-development and simple dedicated-server
  default, not a universal production default.
- Queue runner logic should be reusable from a separate worker entrypoint and
  the in-process worker should be configurable/disableable for serverless,
  horizontally scaled, or separate-runner deployments.
- Action requests should return an operation id for queued execution and status
  lookup.
- Operation status API should be simple and pollable, exposing operation id,
  status, timestamps, action name, scope, optional result, and normalized error.
  Status values should include `queued`, `running`, `succeeded`, `failed`,
  `failed_needs_review`, and `cancelled`.
- The low-level server/API route contract may expose `applied` versus `queued`
  results and pollable operation status.
- The Nuxt UI-facing API should be async/promise based. Composables should
  await queued operations internally and resolve only when the mutation is
  applied/succeeded or reject/return an error state when it fails, is
  cancelled, or needs review. This should fit `useAsyncData`, `useFetch`, and
  client event `$fetch` patterns.
- Nuxt UI-facing mutation helpers should use a configurable default client wait
  timeout. If the operation is still queued/running after that timeout, the
  helper returns a pending operation result instead of waiting indefinitely.
- Default Nuxt helper wait timeout is `10_000ms`, configurable globally and per
  call.
- Operation status should include an optional current `wait_reason` for queued
  or retrying operations: `scope_blocked`, `stale_version_retry`, `scheduled`,
  or `worker_unavailable`.
- Normalized operation errors should use a small MVP code set:
  `CONFLICT_STALE_VERSION`, `CONFLICT_PATCH_TEST_FAILED`,
  `CONFLICT_SCOPE_BLOCKED`, `REMOTE_FAILED`, `REMOTE_TIMEOUT_AMBIGUOUS`,
  `VALIDATION_FAILED`, `UNSUPPORTED_OPERATION`, and `INTERNAL_ERROR`.
- Operation records should be retained indefinitely by default in MVP.
- Automatic operation cleanup is deferred until a concrete retention policy
  exists.
- Operation records should track lightweight retry/attempt metadata:
  `attempt_count`, `last_attempt_at`, and `last_error`.
- Operation records should include queue-claiming metadata such as queue name,
  next available/run-after time, locked-by worker id, and locked-at timestamp.
- Full per-attempt history/log tables are out of scope for MVP.
- `queueOnConflict` should use time-based expiry instead of a max attempt cap.
  `attempt_count` is informational, while queued operations older than a
  configurable `max_queued_age_ms` become `failed_needs_review`.
- Progress percentages, logs, streaming updates, and workflow dashboards are
  out of scope for MVP.
- MVP should not automatically retry failed operations by default.
- Manual re-run should create a new operation.
- Automatic retries are deferred until actions can declare idempotency or a
  stable remote idempotency key.
- MVP cancellation should apply only to queued operations.
- Running operations should not be cancellable in MVP.
- Stale running operations should be marked `failed_needs_review` after a
  configurable timeout, release their concurrency scope, and require manual
  repair or manual re-run.
- Stale queued operations should be marked `failed_needs_review` after a
  configurable `max_queued_age_ms`; `attempt_count` should not be used as a
  hard retry cap in MVP.
- Successful `run` responses should be persisted before `project` starts.
- `run_response` must be JSON-serializable and stored as JSONB.
- Large/binary operation payload storage is out of scope for MVP.
- Remote-backed actions must not hold local database transactions open while
  waiting on remote services.
- Framework documents should keep internal UUID primary keys.
- Remote-backed documents should store remote identity separately as
  `remote_source` and `remote_id` metadata.
- Remote identity should be unique per tenant and collection:
  `(tenant_id, collection, remote_source, remote_id)`.
- Collection adapters own how remote identity is extracted from remote payloads.
- Local-only documents leave remote identity metadata empty.
- MVP validation should include a simple demo/fixture inspired by
  `../s6a_manage`, not a full copy of its domain. The demo should use one
  remote-backed collection with nested projection fields, explicit sync, one
  remote-first action, and a queued JSON Patch retry scenario.
- Defer Temporal, GraphQL Mesh, generated PostgreSQL GraphQL layers, and
  local-first sync frameworks until a concrete remote-backed collection proves
  the need.
- Defer background sync, automatic read-through refresh, conflict resolution,
  and full workflow orchestration.
- Defer first-class workflow engine integration, but keep the adapter/action
  boundary compatible with long-running or resource-locking operations that may
  later be backed by Temporal or a queue.

## Acceptance Criteria

- [ ] Remote-backed collection registration can attach an adapter to a
      collection without affecting local-only collections.
- [ ] Explicit sync/refresh validates remote payloads, maps them into local
      document projections, and upserts them by remote identity.
- [ ] Normal `list`/`getById` for remote-backed collections read the local
      projection only and do not call the remote service.
- [ ] Remote create/update/delete operations call the remote adapter first and
      update the local projection only after remote success.
- [ ] Remote-backed queued writes/actions can defer before remote execution,
      retry local projection after a persisted successful remote response, and
      avoid retrying ambiguous remote execution without declared idempotency.
- [ ] Remote adapter and operation types reserve explicit idempotency metadata
      for adapters that declare stable remote idempotency.
- [ ] A non-CRUD custom action can be registered for a remote-backed
      collection, call the remote adapter, and update or refresh local
      projections only after success.
- [ ] Custom action `project` code can write through the scoped document API
      without bypassing tenant/schema/version rules.
- [ ] Custom actions can be registered and dispatched at document, collection,
      and workspace scopes.
- [ ] Overlapping custom actions are serialized according to their declared
      hierarchical tenant-scoped concurrency scope.
- [ ] Normal CRUD writes can execute immediately, queue on conflict, or always
      queue based on caller mode.
- [ ] UI-facing mutating routes default to queue-on-conflict behavior.
- [ ] Queued CRUD operations preserve expected document versions as conflict
      context.
- [ ] `queueOnConflict` CRUD operations continue to defer/re-enqueue while
      blocked by active broad scopes or stale document versions.
- [ ] Stale-version queueOnConflict retry replays patch-style mutations against
      the latest document by default and requires an explicit rebase policy for
      full-document replacement/update operations.
- [ ] Replayable patch mutations use the standard RFC 6902-compatible subset
      exposed by the local document layer.
- [ ] Replayable patch retry preserves and evaluates `test` operations as
      field-level preconditions.
- [ ] Failed `test` operations during queued patch retry fail the operation
      with a normalized terminal conflict error.
- [ ] Queue worker claim logic safely handles concurrent workers.
- [ ] Action requests create operation records and return operation ids.
- [ ] Operation status can be queried for queued, running, succeeded, failed,
      failed-needs-review, and cancelled states.
- [ ] Low-level mutation endpoints can return immediate `applied` results or
      queued operation handles.
- [ ] Nuxt UI-facing composables expose async/promise-based mutation helpers
      that wait on queued operations and integrate cleanly with `useAsyncData`,
      `useFetch`, and `$fetch` usage.
- [ ] Nuxt UI-facing mutation helpers support a configurable wait timeout and
      return pending operation state when the operation is still queued/running
      after the timeout.
- [ ] Default Nuxt helper wait timeout is `10_000ms` with global and per-call
      overrides.
- [ ] Operation status response includes operation id, status, timestamps,
      action name, scope, optional result, and normalized error.
- [ ] Operation status response includes optional `wait_reason` with the MVP
      reason set when an operation is waiting or retrying.
- [ ] Normalized operation errors use the MVP error code set for conflicts,
      remote failures, validation failures, unsupported operations, and
      internal failures.
- [ ] Operation records include status/timestamps needed for future cleanup,
      but no automatic cleanup runs in MVP.
- [ ] Operation records include `attempt_count`, `last_attempt_at`, and
      `last_error`, without full per-attempt history/log storage.
- [ ] Operation records include queue claiming metadata for safe worker leases
      and delayed re-enqueueing.
- [ ] `queueOnConflict` expiry is time-based using configurable queued/running
      age thresholds, not attempt-count based.
- [ ] Failed operations are not retried automatically by default.
- [ ] Manual re-run creates a new operation record.
- [ ] Queued operations can be cancelled.
- [ ] Running operations reject cancellation or report that they are not
      cancellable.
- [ ] Stale running operations are marked failed-needs-review without automatic
      retry and no longer block their concurrency scope.
- [ ] Stale queued operations older than the configured queued age threshold
      are marked failed-needs-review.
- [ ] Full `run_response` is persisted before `project` starts.
- [ ] Persisted `run_response` can be reused to retry local projection apply
      without re-running the remote side effect.
- [ ] Non-JSON-serializable `run_response` values are rejected or fail the
      operation with a clear error.
- [ ] In-process worker can claim and run queued operations.
- [ ] Queue runner can be reused by a future separate worker entrypoint.
- [ ] In-process worker can be disabled for serverless, horizontally scaled, or
      separate-runner deployments.
- [ ] Remote-backed custom actions call the remote system in `run` outside
      local database transactions, then update projections in `project` through
      scoped document API calls with version checks.
- [ ] Remote mutation failure leaves the local projection unchanged.
- [ ] Remote mapping supports nested projection documents.
- [ ] Invalid remote responses are rejected before persistence.
- [ ] Duplicate remote records are handled consistently by
      `(tenant_id, collection, remote_source, remote_id)`.
- [ ] Local-only collections continue to work without remote identity metadata.
- [ ] A simplified `s6a_manage`-inspired demo fixture exercises remote sync,
      remote-first action execution, projection update, and queued JSON Patch
      retry.
- [ ] Complex-task planning has `design.md` and `implement.md` before this task
      is started.

## Out of Scope

- Core local document table/query implementation, except where required to
  consume its public API.
- Full durable workflow orchestration and conflict-resolution engines.
- Advanced queue features such as scheduling, progress reporting, distributed
  worker scaling, and rich retry policies unless chosen explicitly for MVP.
- Progress/log streaming and workflow dashboards.
- External queue infrastructure such as Redis/BullMQ.
- Automatic refresh during ordinary `list`/`getById`.
- Future GraphQL layer for multi-collection queries.
- Generated admin UI or remote sync management UI.

## Notes

- Parent planning task: `05-19-data-layer-mvp-brainstorm`.
- Depends on `05-19-local-document-data-layer`; implement after the local
  document projection API is available.
