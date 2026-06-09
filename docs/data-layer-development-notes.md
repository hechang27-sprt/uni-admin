# Data Layer Development Notes

This document explains the current data-layer design for maintainers. It is not
a public API reference yet; it records the contracts that exist today and the
constraints that future layers should preserve.

## Scope

Implemented today:

- Multi-tenant document storage in PostgreSQL using structured app and
  collection catalog identity.
- Zod-backed collection registration keyed by `(appKey, collection name)`.
- Local document CRUD, list, soft delete, restore, hard delete, and JSON Patch.
- Batch create, ordered batch get-by-id, and all-or-nothing batch update.
- JSONB-path and metadata filtering, sorting, offset pagination, and deleted-row
  inclusion for repository-backed lists.
- Remote-backed collection registration.
- Explicit remote sync operations.
- Remote-first create, update, and delete wrappers.
- Remote response validation and projection mapping.
- Service-level user identity, username/password credentials, tenant
  memberships, scope-tree RBAC, and actor-scoped document authorization.
- Catalog persistence for apps, tenant app enablement, and registered
  collection identity.
- Kysely-backed repository implementation for runtime use and pgLite-backed
  unit tests.

Not implemented yet:

- Operation records and queue worker.
- Custom action registration and dispatch.
- `queueOnConflict` write modes.
- Nuxt API routes and composables.
- Generated table UI or UI schema runtime.
- Generated user, role, permission, and scope management UI.

## Storage Model

The current database separates catalog identity from document projection rows:

- `tenants`: tenant identity.
- `apps`: framework app identities keyed by stable app keys such as `default`.
- `tenant_apps`: explicit tenant-to-app enablement.
- `collections`: app-scoped collection identities keyed by `(app_id, key)` and
  `(app_id, collection_id)`.
- `documents`: tenant-scoped collection records with JSONB data.

Document rows keep framework-owned identity separate from remote identity:

- `id`: internal UUID primary key.
- `tenant_id`: tenant boundary.
- `app_id`: persisted catalog app identity.
- `collection_id`: persisted catalog collection identity.
- `collection`: legacy-compatible collection name mirror kept populated while
  public service inputs still use `collection`.
- `schema_version`: version of the registered local document schema.
- `data`: JSONB local projection.
- `auth_scope_id`: nullable framework-owned authorization scope. `null`
  represents the tenant-root/global resource scope for authorization checks.
- `remote_source`: optional remote system name.
- `remote_id`: optional remote record identity.
- `version`: optimistic concurrency token.
- `deleted_at`: soft-delete marker.

Document repository operations scope by `tenant_id + app_id + collection_id`.
The service resolves those ids through `CatalogService` from the registered
collection's `appKey` and public `collection` input before calling the
repository.

Remote-backed rows are unique by:

```text
(tenant_id, app_id, collection_id, remote_source, remote_id)
```

Local-only rows leave `remote_source` and `remote_id` empty. The default app is
enabled automatically for a tenant on document access; non-default apps must be
enabled through the catalog boundary before tenant documents can be written.

## Auth/RBAC Model

Auth and authorization live in relational system tables beside the document
table:

- `users` and `user_password_credentials` own framework user identity and the
  starter username/password adapter.
- `tenant_memberships` links users to tenants before an actor context can be
  resolved.
- `auth_scopes` and `auth_scope_closure` model the tenant root and descendant
  resource scopes.
- `roles`, `permissions`, `role_permissions`, and `user_role_assignments`
  implement resource-scoped RBAC.

The service API is exported from `#server/auth`. Projects bind
`KyselyAuthRbacRepository`, `AuthRbacService`, and `DocumentService` through the
server DI container; interface-typed dependencies use runtime symbols from
`#server/di`.

Existing document methods remain trusted/internal entrypoints when called
without service options containing `actor`. Runtime code passes
`DocumentServiceOptions` to the same methods, for example
`create(input, { actor })`, `list(input, { actor })`,
`update(input, { actor })`, and `remoteUpdate(input, { actor })`.
`setDocumentAuthScope` requires service options with `actor` because changing
framework auth metadata is always a protected operation.

Collection CRUD permissions are derived from registration with canonical keys
backed by catalog ids:

```text
<app-id>:<collection-id>:read
<app-id>:<collection-id>:create
<app-id>:<collection-id>:update
<app-id>:<collection-id>:patch
<app-id>:<collection-id>:delete
<app-id>:<collection-id>:restore
<app-id>:<collection-id>:hard-delete
```

Special framework permissions keep explicit keys such as
`admin:documents:set-scope`. App-level permissions use `<app-id>:<capability-id>`.
Collection custom actions use fixed capability ids of `action-<action-id>` and
collection-level canonical keys. Registrations cannot override built-in CRUD
capability ids; this prevents two apps with the same human collection key from
colliding or shadowing built-in behavior.

Remote write authorization runs before adapter side effects. Protected remote
adapter contexts include the normalized actor as `context.actor`.

## Local Document Service

Collections are registered with an app key, a public collection name, local
document schema, and schema version. Omitting `appKey` uses the built-in
`default` app; omitting `definitionKey` uses the collection name:

```ts
import { z } from "zod";
import {
  createCollectionRegistry,
  type DocumentService,
} from "../server/data/documents";
import { createServerContainer, SERVER_DI_TYPES } from "../server/di";
import { db } from "../server/util/kysely";

const taskSchema = z.object({
  title: z.string(),
  status: z.enum(["draft", "submitted", "done"]),
  priority: z.number(),
  tags: z.array(z.string()).default([]),
});

const registry = createCollectionRegistry([
  {
    name: "tasks",
    appKey: "default",
    schema: taskSchema,
    schemaVersion: 1,
  },
]);

const container = createServerContainer({
  database: db,
  registry,
});
const service = container.get<DocumentService>(SERVER_DI_TYPES.DocumentService);
```

The service validates document data before persistence. Mutating methods that
change existing rows require `expectedVersion`, and stale versions fail with
`CONFLICT_STALE_VERSION`.

Batch methods are explicit:

- `createMany` inserts a list of local projections.
- `getByIds` returns results in the same order as the requested IDs and uses
  `null` for missing documents.
- `updateMany` validates every item before the repository write and uses one
  Kysely transaction for the batch update. A stale or missing item prevents
  partial writes.

List queries accept `filter`, `sort`, `limit`, `offset`, and `includeDeleted`.
Filters can target top-level or nested JSONB data paths and framework metadata
fields. Limits are normalized to the current 1..100 range, and repository sorts
add an `id` tie-breaker when callers do not provide one.

JSON Patch supports the current RFC 6902-compatible subset:

- `add`
- `replace`
- `remove`
- `test`

`copy` and `move` are not part of the MVP.

## Remote Adapter Boundary

Remote collection adapters live above the local document service. They own:

- Remote API calls.
- Remote response validation.
- Remote identity extraction.
- Mapping remote payloads into local document projections.
- Optional idempotency metadata for future queue retry decisions.

The adapter contract is explicit:

```ts
interface RemoteCollectionAdapter<
  TData,
  TSyncOneInput,
  TSyncListInput,
  TCreateInput,
  TUpdateInput,
  TDeleteInput,
  TOutputs,
> {
  remoteSource: string;
  syncOne(
    input,
    context,
  ): Promise<RemoteSyncOneResult<TData, TOutputs["syncOne"]>>;
  syncList(
    input,
    context,
  ): Promise<RemoteSyncListResult<TData, TOutputs["syncList"]>>;
  createRemote(
    input,
    context,
  ): Promise<RemoteProjectionResult<TData, TOutputs["create"]>>;
  updateRemote(
    input,
    context,
  ): Promise<RemoteProjectionResult<TData, TOutputs["update"]>>;
  deleteRemote(
    input,
    context,
  ): Promise<RemoteDeleteResult<TData, TOutputs["delete"]> | void>;
}
```

Remote result objects include optional adapter-defined `output` metadata. The
service passes that metadata back to callers without interpreting it, so
adapters can expose cursors, checkpoints, request IDs, rate-limit hints, or
provider-specific warnings without locking the framework into one pagination
shape.

The real TypeScript interface uses typed callback properties with a bivariance
wrapper. This is deliberate: the registry stores heterogeneous adapters, so it
must erase input types at rest while individual adapter implementations still
keep concrete input types.

Do not replace that with `unknown` input defaults on the stored adapter type.
That makes concrete adapters fail assignment when `strictFunctionTypes` is
active in IDE or project-reference checks.

## Remote Projection Flow

Remote sync and remote-first writes all end in the same projection path:

```text
remote payload
  -> adapter validation
  -> adapter projection mapping
  -> local document schema validation
  -> upsert/update local JSONB projection
```

Normal reads do not call remotes:

- `getById` reads the local projection.
- `list` reads the local projection.

Remote refresh is explicit:

- `syncRemoteOne`
- `syncRemoteList`

Remote writes call the adapter first:

- `remoteCreate`
- `remoteUpdate`
- `remoteDelete`

If a remote call fails, local projection data must remain unchanged.

## Repository Layout

The current data layer is split by responsibility:

- `server/data/catalog/repository.ts` owns app, tenant-app, and collection
  catalog persistence.
- `server/data/catalog/service.ts` owns default app setup, registry collection
  sync, tenant app enablement, and collection identity lookup.
- `server/data/documents/repository/types.ts` defines the document repository
  contract.
- `server/data/documents/repository/query.ts` normalizes list input and builds
  Kysely filter/sort expressions.
- `server/data/documents/repository/kysely.ts` implements
  `KyselyDocumentRepository`, including batch update SQL and remote projection
  upserts scoped by structured app and collection ids.
- `server/data/documents/repository/index.ts` is the public repository barrel.
- `server/data/documents/service/contracts.ts` defines the service input,
  output, and interface types.
- `server/data/documents/service/service.ts` implements `DocumentService` and
  resolves public `{ appKey?, collection }` input to catalog ids before
  persistence.
- `server/data/documents/service/helpers.ts` holds shared service validation,
  version, remote adapter, and projection helpers.

There is no separate in-memory repository implementation now. Unit tests create
a pgLite database with `createInMemoryDb()` from `server/util/kysely.ts`, run
the Kysely baseline migration, and exercise the same catalog, document, and auth
repositories used by the service.

## Type-Checking Notes

The root `tsconfig.json` is a project-reference entrypoint with no files of its
own:

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

Plain `tsc --noEmit` checks only the empty root project. Use build mode to
check referenced projects:

```bash
bun run typecheck
```

The script currently runs:

```bash
bunx tsc -b --noEmit
```

## Validation Commands

Run these before treating a data-layer change as complete:

```bash
bun run typecheck
bun run test
bun run build
```

`bun run build` currently emits Nuxt sourcemap and CSS resolution warnings, but
the build completes successfully.

## Maintainer Notes

Keep data-layer changes narrow:

- Preserve tenant scoping in all repository operations.
- Preserve schema validation before persistence.
- Preserve optimistic concurrency for existing document mutations.
- Preserve all-or-nothing semantics for batch updates.
- Keep remote calls outside local database transactions.
- Keep remote-backed read semantics local-only.
- Add or update pgLite-backed unit coverage for `KyselyDocumentRepository`
  behavior.

Future operation queue work should reuse the document service for projection
writes rather than allowing custom action code to mutate database rows directly.
