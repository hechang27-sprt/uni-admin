# Remote Collection Adapters Design

## Architecture

Remote collection adapters sit above the local document service. The local
document layer remains the projection store and query surface. Adapters own
communication with the real remote system, response validation, mapping, and
remote-first mutation ordering.

Collections can be local-only or remote-backed. Local-only collections do not
load remote adapter code or require remote identity metadata.

## Adapter Boundary

A remote-backed collection registration can provide an adapter with:

- remote source name
- remote identity extractor
- response schemas
- `syncOne`
- `syncList`
- `createRemote`
- `updateRemote`
- `deleteRemote`
- custom actions keyed by action name

The adapter never bypasses the local document service. It maps remote payloads
into framework document payloads, then uses the local service to upsert/update
the projection.

## Read Semantics

Normal `getById` and `list` read the local projection only. They do not call the
remote service.

Explicit sync operations call the adapter, validate the remote response, map it
to one or more document payloads, then upsert by:

- `tenant_id`
- `collection`
- `remote_source`
- `remote_id`

This keeps ordinary admin table loading fast and makes remote refresh visible
as a deliberate operation.

## Write Semantics

Remote-backed create/update/delete operations are remote-first:

1. Validate the caller input.
2. Call the remote adapter.
3. Validate the remote success response.
4. Map the remote response into the local projection.
5. Update the local document projection.

If the remote call fails or the remote response is invalid, the local projection
must remain unchanged.

Queued remote-backed writes and actions split retry behavior across the remote
side-effect boundary:

- Before the remote `run`/mutation starts, `queueOnConflict` can defer or
  re-enqueue for active broad scopes.
- After the remote `run`/mutation succeeds, the framework persists the
  validated success response as `run_response`. Local projection apply can then
  retry on stale document versions without re-running the remote side effect,
  as long as the projection is patch-style or derived from the persisted remote
  response.
- Remote failures, invalid remote responses, and ambiguous remote timeouts are
  not auto-retried by default. Retrying remote execution requires the adapter to
  declare a stable idempotency key or equivalent idempotency contract.

Remote idempotency must be explicit adapter metadata rather than an informal
comment. Even though automatic remote retries are deferred, the adapter and
operation record should leave room to store the idempotency key used for a
remote attempt when an adapter declares one.

## Custom Actions

The adapter layer must support non-CRUD server-side actions. Source examples in
`../s6a_manage` include submit/check/execute/copy/toggle and batch assignment
operations.

Custom actions are in the MVP scope for this remote adapter task.

Actions are user-defined server-side TypeScript code. They can be registered at
different scopes:

- Document action: operates on one document/table row.
- Collection action: operates on a whole collection or selected set of
  documents in one collection.
- Workspace action: operates across multiple collections within one tenant.

An action receives tenant context, action input, scope metadata, remote adapters
when applicable, and scoped document/query helpers. A current document is
provided only for document-scoped actions.

Action code is split into two phases:

- `run`: performs remote calls or other business work with read-only local
  document access. It must not write local projections.
- `project`: runs after `run` succeeds inside the framework-controlled apply
  phase. It receives the `run` response and writable scoped document API access
  for local projection writes.

This keeps remote/network side effects separate from local projection mutation
and avoids needing a durable execution platform in the MVP. Projection writes
still go through the normal document service, preserving tenant scoping, schema
validation, soft-delete behavior, optimistic concurrency, and short
transactions.

Actions should not receive raw Drizzle/database access by default because that
would bypass the framework invariants.

For remote-backed actions, the required ordering is:

1. Load the needed local context for `run`.
2. Call the remote system or run business logic in `run`.
3. Validate the response.
4. Enter the framework-controlled apply phase.
5. Run `project` with writable scoped document API access.
6. Commit local projection changes in a short transaction.

The `run` response can also be used as, or mapped to, the API response payload
for the caller.

## Action Callback Research Notes

Comparable systems suggest separating business side effects from persistence
application:

- Directus separates pre-event `filter` hooks from post-event `action` hooks.
  It gives hooks context, including database access, but warns about blocking
  filters, read-hook performance, and recursive event loops.
- Keystone separates input resolution/validation, `beforeOperation`, and
  `afterOperation`. Its after hook runs after persistence; failures there do
  not undo the saved data.
- Payload supports document lifecycle hooks and hook context, warns about
  expensive read hooks and infinite loops, and recommends a jobs queue for
  long-running work.
- Transactional outbox patterns solve the separate problem of atomically
  persisting local changes plus later external messaging without distributed
  transactions.

The implication for this framework: do not allow remote/business action code to
mutate documents during the network phase, but do provide a post-action
projection phase that can convert action results into local document writes
through the normal scoped API.

## Candidate Two-Stage Action Contract

A custom action can be modeled as two callbacks:

1. `run`: user-defined business callback. It receives tenant/scope context,
   input, current document/query context, and remote clients/adapters. It may
   call remote systems and returns an arbitrary action response.
2. `project`: user-defined projection callback. It receives the action response
   from `run`, plus context and the normal scoped document API in writable
   mode. It can directly call the document service to update documents and
   collections.

The framework runs `project` inside the scheduled/apply phase for the action's
declared concurrency scope. In that phase, the normal document API is the write
surface. The API still enforces tenant scoping, schema validation, soft-delete
rules, optimistic concurrency, and transaction boundaries.

This keeps user code expressive while preserving the document store as the
consistency boundary:

- `run` can do network/business work without holding local transactions.
- `project` can translate arbitrary remote responses into document changes
  using the same API as ordinary server-side code.
- The framework controls the scheduling, transaction, and writable context for
  those document API calls.
- Long-running actions can enqueue work and return an operation handle while
  `project` handles projection updates when the queued operation reaches the
  apply phase.

The builder/`ActionResult` style remains useful for declarative actions,
introspection, dry-runs, or future generated UI previews, but it should not be
the only supported projection mechanism. For MVP, the simpler rule is:

- `run` gets read-only document access and may perform remote/network work.
- `project` gets writable scoped document access and must not perform remote or
  long-running work.

Cross-collection actions are allowed at the action layer, but this does not
change the MVP query contract: the generic query interface remains
single-collection. Multi-collection behavior lives in explicit user-defined
action code until the future GraphQL layer exists.

## Action Concurrency

Allowing document, collection, and workspace actions expands the concurrency
model beyond single-document optimistic concurrency. The architecture must make
each action's concurrency boundary explicit, otherwise collection/workspace
actions can silently race with ordinary CRUD or with each other.

The MVP should use layered concurrency rules:

- Single-document writes use optimistic concurrency through document `version`.
  This mirrors document-store patterns such as CouchDB/PouchDB `_rev`,
  RavenDB optimistic concurrency, and Elasticsearch `_seq_no`/`_primary_term`.
- Multi-document local changes happen in `project` and are applied through the
  scoped document API in a short database transaction.
- Each action declares a tenant-scoped concurrency scope before running.
  Examples: `document:<id>`, `collection:<name>`, or `workspace`.
- Actions with overlapping hierarchical scopes should be serialized for the
  same tenant. This requires MVP job/operation tracking instead of fail-fast
  conflicts.
- Scope conflicts are hierarchical:
  - `workspace` blocks all actions for the same tenant.
  - `collection:<name>` blocks collection and document actions for that
    collection in the same tenant.
  - `document:<collection>:<id>` blocks only actions for that same document,
    unless a broader collection/workspace action is running.
- Remote-backed actions remain remote-first. Local database transactions must
  not stay open while waiting on remote services. `run` calls the remote system
  first and validates the response; `project` then applies local projection
  changes in a short transaction with version checks.
- Long-running or resource-locking actions should return an operation handle
  instead of blocking a normal request lifecycle.

These rules keep the document store as the consistency boundary and make custom
actions a controlled extension point rather than unrestricted database scripts.
Raw database access and imperative document mutation remain explicit escape
hatches, not the default action API.

Normal CRUD writes should also respect active broad action scopes. Because this
framework backs UI workflows, callers should be able to choose conflict
behavior:

- `mode: "immediate"`: direct write fails with a typed conflict when a running
  workspace action or matching collection action is active for the same tenant.
- `mode: "queueOnConflict"`: if a broad scope is active, the write is converted
  into an operation record and queued behind that scope. If no broad scope is
  active, it executes immediately.
- `mode: "queued"`: always create an operation record and execute through the
  queue.

UI-facing routes should default to `queueOnConflict` for mutating operations so
button/form submissions remain ergonomic during collection/workspace actions.
Server-side callers can opt into `immediate` when they want strict synchronous
failure semantics.

Queued CRUD operations must preserve the caller's original expected version for
update, patch, delete, and restore as conflict context. When the operation
reaches the apply phase, that expected version is checked against the current
document version.

For `queueOnConflict`, both active broad scope blockers and stale document
versions are retryable conflicts. If a queued CRUD operation is blocked by a
workspace/collection action or finds a stale version at apply time, it stays
queued or is re-enqueued for another attempt instead of failing immediately.
Other failures remain terminal by default.

This means `queueOnConflict` is more than delayed execution: it is a UI-friendly
eventual-apply mode. Stale-version retry is replayable by default only for
patch-style mutations: the worker re-reads the latest document, applies the
stored patch intent, validates the result, and attempts the versioned write
again. The stored patch intent must use the local document layer's RFC
6902-compatible JSON Patch subset with standard operation names and JSON
Pointer paths. The MVP subset is `add`, `replace`, `remove`, and `test`;
`move` and `copy` are deferred. `test` operations are preserved during stale
retry and act as field-level preconditions against the latest document. If a
`test` operation fails, the queued operation fails with a terminal conflict
instead of re-enqueueing, because the patch's explicit precondition is false.
Retryable `test` failures are deferred as a nonstandard, per-operation policy
until a concrete workflow needs wait-until-precondition behavior.
Full-document replacement/update operations are not replayed by default because
they can overwrite fields the user never saw; they require an explicit rebase
policy before retrying against a newer document version.

The MVP should avoid using PostgreSQL `SERIALIZABLE` as the primary concurrency
mechanism. Serializable transactions can be useful for narrow cases, but
document-store semantics are clearer with explicit document versions,
short transactions, and application-level scope serialization.

For queue claiming, use PostgreSQL row locks with `FOR UPDATE SKIP LOCKED` so
multiple workers can safely claim different queued operations without blocking
each other.

## Job Queue And Operation Tracking

Queued action execution is part of the MVP because collection/workspace actions
are otherwise painful to use. The MVP queue should be backed by PostgreSQL
operation records rather than an external Redis/BullMQ dependency. It does not
need full workflow-engine features, but it must provide enough structure to
serialize overlapping scopes and expose operation status.

Minimum operation model:

- `id`
- `tenant_id`
- `queue_name`: default queue partition for MVP operation claiming
- `action_name`
- `scope_type`: document, collection, workspace
- `scope_key`: concrete hierarchical scope identifier used for serialization
- `collection`: nullable for workspace actions
- `document_id`: nullable for collection/workspace actions
- `input`
- `status`: queued, running, succeeded, failed, failed_needs_review,
  cancelled
- `available_at`: when a queued/re-enqueued operation can next be claimed
- `locked_by`: worker identifier for an active claim
- `locked_at`: timestamp for the active claim
- `run_response`: optional serialized successful `run` response
- `result`: optional API-facing result payload
- `error`: optional failure payload
- `wait_reason`: optional current reason for queued/retrying state
- `attempt_count`
- `last_attempt_at`
- `last_error`
- `created_at`, `started_at`, `finished_at`

Operation status API:

- The MVP exposes a simple pollable status shape with `operationId`, `status`,
  timestamps, `actionName`, `scope`, optional `result`, optional
  `waitReason`, and normalized `error`.
- Progress percentages, logs, streaming updates, and workflow dashboards are
  out of scope for MVP.

API layering:

- The server-side TypeScript service and low-level API routes may expose
  immediate-vs-queued results and operation handles. This keeps operation state
  inspectable and scriptable.
- Nuxt UI-facing composables should present async/promise-based mutation
  helpers. If a mutation queues, the composable waits by polling operation
  status internally until the operation reaches `succeeded`, `failed`,
  `failed_needs_review`, `cancelled`, or the configured client wait timeout.
- The Nuxt-facing helper resolves with the applied document/result on success.
  It rejects or returns the normal Nuxt error state for terminal failure,
  cancellation, failed-needs-review, validation errors, and patch conflicts.
- If the configured client wait timeout is reached while the operation is still
  queued/running, the helper resolves with pending operation state:
  `{ status: "pending", operationId, waitReason? }`.
- Default client wait timeout is `10_000ms`. It should be configurable in the
  framework app config/runtime config and overridable per mutation call.
- Initial data and read refreshes should fit `useAsyncData`/`useFetch`.
  Event-driven form submissions can use `$fetch` directly or a composable that
  wraps `$fetch` plus operation-status polling.

`waitReason` is current state, not a log. MVP values:

- `scope_blocked`
- `stale_version_retry`
- `scheduled`
- `worker_unavailable`

Normalized operation errors use this MVP code set:

- `CONFLICT_STALE_VERSION`
- `CONFLICT_PATCH_TEST_FAILED`
- `CONFLICT_SCOPE_BLOCKED`
- `REMOTE_FAILED`
- `REMOTE_TIMEOUT_AMBIGUOUS`
- `VALIDATION_FAILED`
- `UNSUPPORTED_OPERATION`
- `INTERNAL_ERROR`

Error payloads should include a user-safe message plus structured details when
useful, such as failed JSON Pointer path, expected/current version, remote
source, or validation issues. Raw thrown errors are not returned directly from
the API surface.

Retention policy:

- Operation records are retained indefinitely by default in MVP.
- Automatic cleanup is deferred until a real retention policy exists.
- Timestamps and status fields should make future cleanup by status/time easy.
- Full per-attempt history/log tables are out of scope. MVP operation records
  keep only `attempt_count`, `last_attempt_at`, and `last_error` so the UI can
  show retry activity and developers can inspect the latest blocker/failure.
- `queueOnConflict` uses time-based expiry rather than a max attempt cap.
  `attempt_count` is informational. A queued operation older than
  `max_queued_age_ms` becomes `failed_needs_review` so it does not wait
  forever.

Retry policy:

- MVP does not automatically retry failed operations by default.
- Failures move the operation to `failed` with normalized error details.
- Manual re-run is modeled as creating a new operation.
- Automatic retries can be added later only for actions that explicitly declare
  idempotency or a stable remote idempotency key.
- `queueOnConflict` is the MVP exception to the no-automatic-retry default for
  normal CRUD writes. It can remain queued or be re-enqueued for active broad
  scope blockers and stale-version conflicts. Other apply failures stay
  terminal for that operation.
- For remote-backed queued writes/actions, the retryable stale-version conflict
  is limited to the local projection phase after a successful `run_response`
  has been persisted. The remote `run`/mutation is not retried after ambiguous
  execution unless the adapter declares a stable idempotency key.

Cancellation policy:

- MVP supports cancellation only while an operation is still `queued`.
- Running operations are not cancellable in MVP because remote `run` work may
  already have caused side effects.
- Cancellation of running operations is deferred until workflow/compensation or
  remote cancellation support exists.

Crash/stale-running policy:

- Queued operations older than configurable `max_queued_age_ms` are marked
  `failed_needs_review`.
- Running operations older than a configurable timeout are marked
  `failed_needs_review`.
- Their concurrency scopes are released so later operations are not blocked
  forever.
- Stale running operations are not automatically retried in MVP because the
  remote `run` phase may already have produced side effects.
- The persisted `run_response` is the main evidence for manual projection
  repair when a crash happens after `run` succeeds.
- `run_response` must be JSON-serializable and is stored as JSONB.
- Large or binary `run` responses are out of scope for MVP; actions should
  store references, URLs, or remote IDs instead.
- Manual review decides whether to repair projection data or create a new
  operation.

Execution model:

1. Action request creates an operation record and returns its operation id.
2. A worker claims queued operations whose tenant/scope is not currently
   running.
3. Worker executes `run` outside local DB transactions.
4. Worker persists the full `run_response`.
5. Worker executes `project` inside the framework-controlled apply phase.
6. Worker stores status/result/error.

Worker deployment:

- MVP defaults to an in-process worker running inside the Nuxt server for local
  development and starter-template ergonomics.
- The queue runner should be implemented as reusable server-side TypeScript so
  a separate worker entrypoint can launch the same runner later.
- The in-process worker must be easy to disable through configuration when a
  separate worker process is introduced.
- Treat the in-process worker as the development and simple dedicated-server
  default, not as a universal production default. Serverless and horizontally
  scaled deployments should be able to disable it and run queue processing from
  an explicit external runner or scheduled endpoint.

Delayed jobs, scheduling, cancellation semantics, progress updates, retries,
and distributed worker scaling can be minimal in MVP, but the operation table
must not preclude adding them later.

First-class workflow engine integration remains deferred, but the action
boundary should be compatible with later Temporal-backed implementations.

## Projection Shape

Remote mappings may produce nested or denormalized document payloads. This is
required for admin rows that combine multiple concepts, such as task target
rows with task/session/executor metadata.

## Demo Fixture

The MVP should include a simplified demo/fixture inspired by `../s6a_manage`
rather than copying the full application domain. A good fixture is a
remote-backed `workItems` or `smsTargets` collection with:

- nested display fields such as task name, assignee/executor name, status, and
  enabled/review flags
- `syncList` that validates fake remote payloads and upserts local projections
- one remote-first action such as `submitForReview` or `toggleEnabled`
- a projection function that updates the local JSONB document from the remote
  success response
- one queued JSON Patch scenario that can be blocked by a collection action and
  then replayed against the latest projection

## Deferred Work

- Background sync scheduling.
- Retry queues.
- Conflict resolution engine.
- Workflow engine integration.
- Automatic refresh during ordinary reads.
- Remote sync management UI.
