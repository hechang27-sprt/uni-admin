# Data Layer Design Review: Comparable Systems

Date: 2026-05-20

## Scope

Review the current parent and child planning artifacts for:

- PostgreSQL JSONB document storage and query/index tradeoffs.
- Tenant scoping and future row-level security.
- Code-defined collection schemas and schema versions.
- JSON Patch and optimistic concurrency.
- Remote-backed collection projections.
- Custom server-side actions.
- PostgreSQL-backed operation queue and in-process worker.
- Nuxt starter-template-first packaging.

## Sources Reviewed

- PostgreSQL JSON/JSONB types and indexing:
  https://www.postgresql.org/docs/current/datatype-json.html
- PostgreSQL row-level security:
  https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL explicit locking / row locks:
  https://www.postgresql.org/docs/current/explicit-locking.html
- RFC 6902 JSON Patch:
  https://datatracker.ietf.org/doc/html/rfc6902
- Directus data model and hooks:
  https://docs.directus.io/app/data-model
  https://directus.io/docs/guides/extensions/api-extensions/hooks
- Payload jobs queue:
  https://payloadcms.com/docs/jobs-queue/overview
- Payload hooks:
  https://payloadcms.com/docs/hooks/overview
- Keystone hooks:
  https://keystonejs.com/docs/config/hooks
- Hasura actions and async actions:
  https://hasura.io/docs/2.0/actions/overview/
  https://hasura.io/docs/2.0/actions/async-actions/
- CouchDB document revisions and conflicts:
  https://docs.couchdb.org/en/stable/replication/conflicts.html
- Elasticsearch optimistic concurrency:
  https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html
- Nuxt layers and modules:
  https://nuxt.com/docs/getting-started/layers
  https://nuxt.com/docs/guide/going-further/modules
- Drizzle indexes:
  https://orm.drizzle.team/docs/indexes-constraints
- Vitest:
  https://vitest.dev/guide/

## Current Decisions That Look Sound

### Starter-template-first, module-ready internals

Nuxt layers and modules support extraction later, but the current repo is a
minimal Nuxt app. The existing decision to build as a starter/template first,
while keeping server services and framework internals separated, is sound.
Starting with a module would add packaging complexity before the local data
contracts are proven.

### Explicit tenant metadata plus future RLS

Keeping `tenant_id` as a real column and requiring tenant context in the
service is correct. PostgreSQL row-level security is a useful later defense-in-
depth layer, but it should not replace explicit application-level scoping. This
also keeps test scenarios clear: every query/mutation should prove tenant
filters are applied even without RLS enabled.

### Local JSONB projections for remote-backed collections

The Directus/Payload/Hasura comparison supports the current BFF/projection
model. Normal reads should not call remote services, and explicit sync/action
operations should validate remote responses before writing local projections.
This fits admin-table latency and makes remote side effects explicit.

### Custom actions outside generic CRUD

Hasura actions, Directus hooks/flows, Payload hooks/jobs, and Keystone hooks all
separate generated CRUD from custom business logic. The current plan to keep
complex joins and workflows in explicit server-side action code is the right
boundary for an MVP. Trying to express all business logic in a generic query
DSL would likely recreate a poor version of SQL or GraphQL too early.

### Two-phase `run` / `project` action boundary

The two-stage action contract is a strong design. Comparable systems warn
against blocking hooks and long-running request lifecycle work; Payload pushes
expensive hook work into jobs. Keeping remote/business side effects in `run`
and local projection writes in `project` avoids open local DB transactions
during network calls and gives the framework a controlled apply phase.

### Optimistic concurrency plus patch-style replay

CouchDB and Elasticsearch both reinforce the idea that document writes need an
explicit version/revision guard. JSON Patch `test` is a standard way to encode
field-level preconditions. The current decision to replay queued stale-version
retries by default only for patch-style operations is sound; full document
replacement is too likely to overwrite unseen changes unless a rebase policy is
declared.

### PostgreSQL-backed queue for MVP

Payload's jobs queue shows that persisted operation records are a normal CMS
pattern. Starting with PostgreSQL operation rows avoids Redis/Temporal
infrastructure for the MVP and keeps operation status inspectable in the same
database.

## Ideas To Borrow

### Make operation queue deployment mode explicit

Payload distinguishes queuing from running, supports separate runner
processes, and warns that auto-run style background work is not appropriate on
serverless platforms. The current design says the in-process worker should be
configurable and reusable, but it should be more explicit:

- In-process worker is the local/development and simple dedicated-server
  default.
- Production/serverless deployments should be able to disable it.
- A separate runner entrypoint should be a first-class implementation shape,
  even if the MVP only wires it lightly.

### Add queue fields that support safe claiming and deferred retry

The current operation table has status and attempt metadata, but queue workers
will need more than that to claim safely and avoid busy loops:

- `queue_name` or equivalent partition key, even if MVP uses one default queue.
- `available_at` / `run_after` for re-enqueueing due to scope blockers,
  stale-version retry, or scheduled future work.
- `locked_by` and `locked_at` for worker leases.
- `priority` can be deferred, but the schema should not make it painful later.

The worker should claim rows with row locking such as `FOR UPDATE SKIP LOCKED`,
mark them running/locked in the same short transaction, then release the DB
transaction before remote `run` work.

### Treat JSONB query performance as a contract limitation

PostgreSQL JSONB with a general GIN index is flexible, but it does not make
every JSON path comparison, text search, sorting path, and pagination pattern
cheap. The design should explicitly say:

- General GIN supports flexible containment/jsonpath-style filtering, not all
  comparison and ordering cases.
- JSONB path sorting may need expression indexes or generated columns once hot
  fields are known.
- MVP should include deterministic ordering with an `id` or `created_at` tie
  breaker.
- Query APIs should have pagination limits to avoid unbounded scans.

This is not a reason to abandon JSONB. It is a reason to make performance
expectations honest and avoid promising index-backed arbitrary reporting.

### Consider persisted schema identity beyond numeric version

The design already stores `schema_version`. Comparable CMSs tend to keep
collection metadata explicit. For code-defined schemas, consider persisting:

- `schema_version`: current planned numeric version.
- optional `schema_name` or collection already acts as this.
- optional future `schema_hash` to detect code/schema drift during migrations.

`schema_hash` can be deferred, but the design should leave room for it.

### Keep operation status separate from audit history

The current design defers audit/history, which is right. Operation records are
not a document audit log. They explain queued work and action outcomes; they do
not reconstruct every field mutation. This distinction should stay explicit so
operation retention does not accidentally become an audit requirement.

## Assumptions To Correct Or Tighten

### General GIN index is not enough for all promised query behavior

The current requirement says equality/comparison filters, sorting, pagination,
and JSONB-path filters are supported. That is fine as a functional API promise,
but not as a performance promise. A general GIN index on `data` is not enough
for all path comparisons and sorts. The design should tighten language around
indexing and test both functional behavior and query bounds.

### In-process worker should not be the implied production default everywhere

The current wording says the worker should run in-process by default. That is
good for a starter template and local development, but it can be a bad default
on serverless or horizontally scaled deployments. The design should explicitly
separate development/simple deployment from production/serverless posture.

### Queue-on-conflict stale-version retry needs an expiry/backoff mechanism

The current design says time-based expiry is used, but the operation model does
not include a concrete `available_at`/`run_after`. Without that, blocked jobs
can either spin too aggressively or require ad hoc worker sleep logic. Add a
scheduled availability timestamp to the operation schema.

### JSON Patch semantics should stay close to RFC 6902

The design says RFC 6902-compatible subset. Implementation should preserve the
standard edge cases that matter:

- `remove` and `replace` fail when the target path does not exist.
- `add` has special array semantics.
- `test` compares the current value and fails the operation if it does not
  match.
- `move` and `copy` are rejected in MVP.

This should be encoded in tests, not inferred from prose.

### Remote side-effect idempotency should be adapter metadata, not a comment

The design correctly avoids retrying ambiguous remote execution without
idempotency. The adapter type should make this explicit with optional metadata
or a callback for idempotency keys. Even if automatic remote retry is deferred,
the operation record should be able to store the idempotency key used for a
remote attempt.

## Potential Reworks

No full overhaul is needed before implementing the local document layer. The
major structure is coherent: local document service first, remote adapter/action
layer second, queue only where custom actions and broad scopes require it.

Recommended pre-activation adjustments:

1. Update the local document design to clarify JSONB query/index performance
   boundaries, deterministic ordering, and pagination limits.
2. Update the remote adapter design to add queue claim/lease fields:
   `available_at` or `run_after`, `locked_by`, `locked_at`, and an optional
   queue partition key.
3. Update the remote adapter design to make in-process worker mode a
   development/simple-deployment default, with serverless/production able to
   disable it and use a separate runner.
4. Update the adapter contract to reserve explicit idempotency metadata for
   remote calls, even if automatic remote retry remains deferred.
5. Add Vitest acceptance checks for JSON Patch RFC edge cases, not only happy
   path patch application.

## Decisions That Should Not Change Yet

- Do not switch to Directus/Strapi/Payload as the core. Their designs are
  useful references, but this project needs a Nuxt-native starter template with
  custom BFF projection semantics and project-specific server code.
- Do not introduce Temporal for MVP. The operation queue should be small and
  explicit until real long-running workflow requirements exceed it.
- Do not introduce GraphQL as the first query layer. Single-collection query
  plus explicit custom server-side code is enough for the first data-layer MVP.
- Do not make RLS a prerequisite for MVP. Service-level tenant isolation tests
  are the immediate guardrail; RLS can be added later.
- Do not make a dynamic database-stored schema registry the MVP default.
  Code-defined schemas match the starter-template consumption model.
