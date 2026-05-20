# Remote Collection Adapters Implementation Plan

## Checklist

- [ ] Confirm the local document service API from
      `05-19-local-document-data-layer` is available.
- [ ] Define remote adapter TypeScript types.
- [ ] Reserve explicit remote idempotency metadata in adapter and operation
      types, even though automatic remote retries remain deferred.
- [ ] Extend collection registration to mark collections as local-only or
      remote-backed.
- [ ] Implement remote identity extraction and upsert-by-remote-identity.
- [ ] Implement explicit `syncOne` and `syncList` service operations.
- [ ] Implement remote-first create/update/delete wrappers.
- [ ] Implement custom action registration and dispatch.
- [ ] Model document, collection, and workspace action scopes.
- [ ] Model action concurrency scopes.
- [ ] Implement hierarchical scope conflict detection: workspace, collection,
      and document scopes.
- [ ] Add normal CRUD write conflict modes: immediate, queueOnConflict, queued.
- [ ] Make UI-facing mutating routes default to queueOnConflict.
- [ ] Convert conflicted queueOnConflict CRUD writes into operation records.
- [ ] Store the caller's expected document version on queued CRUD
      update/patch/delete/restore operations.
- [ ] Treat stale document version as a retryable conflict for queueOnConflict
      CRUD operations.
- [ ] Keep queueOnConflict CRUD operations queued or re-enqueue them when the
      blocker is an active broad workspace/collection scope or stale document
      version.
- [ ] Replay stale-version retries by default only for patch-style mutations:
      re-read latest document, apply stored patch intent, validate, then
      attempt the versioned write again.
- [ ] Store replayable patch intent as the local document layer's RFC
      6902-compatible JSON Patch subset.
- [ ] Ensure queued patch retry supports `add`, `replace`, `remove`, and
      `test`, preserving `test` as a field-level precondition.
- [ ] Treat failed `test` during queued patch retry as a terminal conflict with
      a normalized error containing the failed path.
- [ ] Require an explicit rebase policy before retrying full-document
      replacement/update operations against a newer document version.
- [ ] Add PostgreSQL operation/job records for queued custom action execution.
- [ ] Include queue claiming fields on operation records: queue name,
      available/run-after timestamp, locked-by worker id, and locked-at
      timestamp.
- [ ] Implement operation status transitions: queued, running, succeeded,
      failed, failed_needs_review, cancelled.
- [ ] Add lightweight attempt tracking fields: `attempt_count`,
      `last_attempt_at`, and `last_error`.
- [ ] Implement a simple pollable operation status API shape with operation id,
      status, timestamps, action name, scope, optional result, and normalized
      error.
- [ ] Add optional operation `wait_reason` and expose it as `waitReason` in
      status responses.
- [ ] Support MVP wait reasons: scope_blocked, stale_version_retry, scheduled,
      worker_unavailable.
- [ ] Keep low-level mutation/API route contract explicit about immediate
      applied results versus queued operation handles.
- [ ] Add Nuxt-facing async mutation helpers/composables that poll queued
      operation status internally and resolve/reject with Nuxt-friendly promise
      semantics.
- [ ] Add configurable client wait timeout behavior to Nuxt-facing mutation
      helpers; return pending operation state when timeout is reached before a
      terminal operation status.
- [ ] Set default Nuxt helper wait timeout to `10_000ms`, configurable globally
      and per call.
- [ ] Ensure read-side refreshes can be composed with `useAsyncData`/`useFetch`
      and event-driven mutations can use `$fetch` or the async helper.
- [ ] Define normalized operation error codes:
      CONFLICT_STALE_VERSION, CONFLICT_PATCH_TEST_FAILED,
      CONFLICT_SCOPE_BLOCKED, REMOTE_FAILED, REMOTE_TIMEOUT_AMBIGUOUS,
      VALIDATION_FAILED, UNSUPPORTED_OPERATION, INTERNAL_ERROR.
- [ ] Map local document conflicts, patch failures, remote failures,
      validation failures, unsupported patch operations, and unexpected errors
      into the normalized operation error shape.
- [ ] Retain operation records indefinitely by default and include fields needed
      for future cleanup.
- [ ] Do not add full per-attempt history/log storage in MVP.
- [ ] Add configurable operation age thresholds, including `max_queued_age_ms`
      and `max_running_age_ms`.
- [ ] Use time-based expiry for queueOnConflict operations; keep
      `attempt_count` informational rather than a hard retry cap.
- [ ] Mark operation failures as failed without automatic retry by default.
- [ ] Model manual re-run as a new operation.
- [ ] Implement cancellation only for queued operations.
- [ ] Reject or report not-cancellable for running operation cancellation.
- [ ] Mark stale running operations as failed_needs_review after a configurable
      timeout and release their concurrency scopes.
- [ ] Mark stale queued operations as failed_needs_review after
      `max_queued_age_ms`.
- [ ] Implement tenant-scoped serialization for overlapping concurrency scopes.
- [ ] Implement an in-process Nuxt server worker for MVP operation execution.
- [ ] Structure queue runner logic so a separate worker entrypoint can reuse it.
- [ ] Add configuration to disable the in-process worker for serverless,
      horizontally scaled, or separate-runner deployments.
- [ ] Define the two-stage custom action contract: `run` and optional
      `project`.
- [ ] Ensure `run` receives read-only document context and may perform remote
      work.
- [ ] Persist full `run_response` before `project` starts.
- [ ] Store `run_response` as JSONB and reject/fail non-JSON-serializable
      responses with a clear error.
- [ ] Ensure `project` receives writable scoped document API access and runs
      inside the framework-controlled apply phase.
- [ ] Optionally define `ActionResult` variants for declarative actions,
      dry-runs, or future generated UI previews, but do not require them for
      MVP projection writes.
- [ ] Provide `run` with read-only local context/query helpers scoped to the
      action scope.
- [ ] Provide `project` with writable scoped document API helpers.
- [ ] Restrict read helpers according to action scope.
- [ ] Ensure overlapping hierarchical action concurrency scopes are serialized.
- [ ] Use PostgreSQL row locks with `FOR UPDATE SKIP LOCKED` or equivalent for
      worker operation claiming.
- [ ] Ensure `project` writes preserve tenant scoping, schema validation,
      soft-delete behavior, and optimistic concurrency rules.
- [ ] Ensure remote calls are not made while local database transactions are
      open.
- [ ] Ensure remote-backed custom actions update local projections only after
      remote success.
- [ ] Split remote-backed queued retry behavior: defer before remote execution,
      persist successful run_response, retry only local projection apply on
      stale versions, and avoid retrying ambiguous remote execution without
      adapter-declared idempotency.
- [ ] Add validation for remote responses before projection persistence.
- [ ] Add tests or validation scripts for sync, remote-first write failure,
      nested mapping, remote identity uniqueness, queued custom actions,
      operation status, and scope serialization.
- [ ] Add a simplified `s6a_manage`-inspired demo fixture with one
      remote-backed collection, explicit sync, one remote-first action, nested
      projection mapping, and queued JSON Patch retry.

## Validation Commands

- `bun run build`
- `bun run test` after the local document child task adds Vitest and the
  project test script.

## Risk Points

- Accidentally calling remotes during normal `list`/`getById`.
- Updating local projections before remote success.
- Ambiguous remote identity extraction.
- Custom actions becoming an untyped escape hatch.
- `ActionResult` becoming too broad and recreating arbitrary scripting through
  data structures.
- Long-running operations needing idempotency or locks earlier than expected.
- Collection/workspace actions racing with ordinary CRUD or other actions.
- Queue implementation can grow into a crude workflow engine if retry,
  cancellation, progress, and scheduling semantics are not kept narrow.

## Rollback Points

- Collection registration changes for remote-backed collections.
- Remote adapter service wrappers.
- Custom action dispatch surface.

## Follow-Up Checks Before Start

- Use a simplified `../s6a_manage`-inspired collection/action as the concrete
  fixture; do not copy the full domain model.
