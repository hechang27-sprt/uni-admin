# App Catalog Identity Migration Design

## Context

The current model treats a collection key as globally code-defined framework content and a tenant id as the only durable organizational dimension:

```text
documents: tenant_id + collection
permissions: globally unique key
roles/grants: tenant_id + permission key
```

That is enough for a framework data-layer MVP, but it does not fit tenant-specific app catalogs or reusable app/module definitions. Making collections tenant-owned directly would overload `tenant_id`: it would own both organization data and content/catalog identity. The preferred model introduces `app_id` as the reusable content dimension.

## Decision

Adopt this hierarchy:

```text
tenant
  owns data and tenant-local role/scope assignments

app
  owns reusable content/catalog definitions

tenant_app
  enables/configures an app for a tenant

collection
  belongs to an app

document
  belongs to tenant + app + collection

permission
  belongs to global/framework, app, or collection identity

role_permission
  belongs to tenant role grants and references permission identity
```

Keep a default built-in app during migration so current code-defined collections can cut over without forcing route/UI/app-builder work first.

## Target Schema

### `apps`

```sql
apps (
  app_id uuid primary key default gen_random_uuid(),
  key text not null,
  name text,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key)
)
```

`apps.key` should use the same safe slug grammar as collection and action keys.

### `tenant_apps`

```sql
tenant_apps (
  tenant_id uuid not null references tenants(id) on delete cascade,
  app_id uuid not null references apps(app_id) on delete cascade,
  config jsonb,
  enabled_at timestamptz not null default now(),
  primary key (tenant_id, app_id)
)
```

This table says which tenants can use an app. It does not make the tenant own the app definition.

### `collections`

```sql
collections (
  collection_id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(app_id) on delete cascade,
  key text not null,
  definition_key text not null,
  name text,
  schema_version integer not null,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, key),
  unique (app_id, collection_id)
)
```

`definition_key` links a persisted collection record to a code-defined schema registration. For the first migration, dynamic tenant-authored schemas stay out of scope.

### `documents`

Target document identity:

```sql
documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  app_id uuid not null references apps(app_id),
  collection_id uuid not null references collections(collection_id),
  schema_version integer not null,
  data jsonb not null,
  auth_scope_id uuid references auth_scopes(scope_id) on delete restrict,
  remote_source text,
  remote_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
)
```

Required invariants:

```text
(tenant_id, app_id) must exist in tenant_apps.
(collection_id, app_id) must exist in collections.
document.tenant_id remains the data-isolation boundary for every query.
```

Recommended indexes:

```text
documents_tenant_app_collection_deleted_idx on (tenant_id, app_id, collection_id, deleted_at)
documents_tenant_app_collection_auth_scope_idx on (tenant_id, app_id, collection_id, auth_scope_id)
documents_tenant_auth_scope_idx on (tenant_id, auth_scope_id)
documents_remote_identity_unique on (tenant_id, app_id, collection_id, remote_source, remote_id)
  where remote_source is not null and remote_id is not null
documents_data_gin_idx on data using gin
```

During compatibility migration, `documents.collection` may remain temporarily as a denormalized string for callers and backfill. It should not remain the authoritative identity after the cutover.

### `permissions`

Target permission identity:

```sql
permissions (
  key text primary key,
  app_id uuid references apps(app_id) on delete cascade,
  collection_id uuid references collections(collection_id) on delete cascade,
  capability_id text not null,
  source text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

`key` is the durable permission identity. Do not add `permission_id` or
`display_key` in the initial app-catalog model. A separate UUID primary key only
adds another identity for the same immutable permission and forces extra joins
through `permissions` before role grants can be evaluated.

Canonical key format:

```text
<app-location>:<collection-location>:<capability-id>
<app-location>:<capability-id>
```

Where:

```text
<app-location> = app uuid, or reserved keyword `admin` / `global`
<collection-location> = collection uuid when the permission is collection-scoped
<capability-id> = safe slug capability id
```

Examples:

```text
admin:tenant-owner
admin:role-permissions-grant
global:system-read
<app-id>:manage
<app-id>:<collection-id>:read
<app-id>:<collection-id>:update
<app-id>:<collection-id>:action-approve
```

Built-in collection CRUD capabilities are fixed framework capability ids:

```text
read
create
update
patch
delete
restore
hard-delete
```

Projects cannot override those built-in capability ids or remap them per
collection. Projects can define additional custom action capability ids only.
Action capabilities should be namespaced with an `action-` prefix in the
canonical key, for example `action-approve`, so custom action ids cannot collide
with built-in CRUD ids.

`source` denotes permission location (`collection`, `app`, `global`, or
`admin`). It must not use `action`; custom action identity is already encoded in
`capability_id` as `action-<action-id>`.

Scopes:

```text
admin/global permission:
  app_id is null
  collection_id is null
  key starts with reserved `admin:` or `global:` location

app-level permission:
  app_id is not null
  collection_id is null
  key = <app-id>:<capability-id>

collection-level permission:
  app_id is not null
  collection_id is not null
  key = <app-id>:<collection-id>:<capability-id>
```

Role grants should reference `permissions.key` directly:

```sql
role_permissions (
  tenant_id uuid not null references tenants(id) on delete cascade,
  role_id uuid not null references roles(role_id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, role_id, permission_key)
)
```

Additional check constraints or service validation should enforce consistency
between `key`, `app_id`, `collection_id`, and `capability_id`. The important
invariant is that `permissions.key` is both unique and canonical, not a mutable
UX label.

## API Compatibility Strategy

### First slice

Keep current public document inputs:

```ts
{ tenantId, collection: "tasks" }
```

Interpret them against a default app:

```text
DEFAULT_APP_KEY = "default"
collection key = input.collection
```

The service resolves `collection` through the registry and the catalog repository before persistence. Repository methods receive normalized identity:

```ts
{
  tenantId: string;
  appId: string;
  collectionId: string;
  collection: string; // temporary compatibility/display field if retained
}
```

### Future slice

Add explicit app-aware inputs only when needed:

```ts
{ tenantId, app: "crm", collection: "tasks" }
```

Avoid adding this public shape until the default-app migration works end-to-end.

## Collection Registry Integration

The process-local `CollectionRegistry` remains the owner of code-defined schemas.
It grows app-aware registration metadata and the executable custom action key
set:

```ts
{
  appKey?: "default";
  name: "tasks";
  definitionKey?: "tasks";
  schemaVersion: 1;
  schema: taskSchema;
  actions?: {
    approve: {
      input?: approveInputSchema;
      handler: approveTask;
    };
  };
  auth?: {
    actions?: {
      approve?: { resourceScope?: "document" | "tenant-root" } | false;
    };
  };
}
```

Initial defaults:

```text
appKey defaults to "default".
definitionKey defaults to collection name.
```

Registry uniqueness changes from `name` to `(appKey, name)`.

Catalog sync should create/update:

```text
apps from app keys
collections from registry entries
tenant_apps for explicit tenant enablement/bootstrap flows
permissions from collection/action declarations
```

## Auth/RBAC Integration

Current affected paths:

- `AuthRbacService.syncBuiltInAdminPermissions()`
- `AuthRbacService.syncCollectionPermissions(registry)`
- `AuthRbacService.assignPermissionToRole()`
- `AuthRbacService.evaluateAccess()`
- `KyselyAuthRbacRepository.upsertPermissions()`
- `assignPermissionsToRole()`
- `findInvalidPermissionKey()`
- `checkCapabilities()`
- `listAccessibleScopeIds()`
- `listGrantedScopeIdsForCapability()`
- `selectGrantedPermissions()` in `server/db/query.ts`

Migration direction:

1. Add structured permission definitions with optional `appKey`, `collectionKey`, and `capabilityId`.
2. Resolve definitions to `app_id` / `collection_id` during permission sync.
3. Generate one canonical primary key from ids: `<app-id>:<collection-id>:<capability-id>` or `<app-id>:<capability-id>`.
4. Treat `admin` and `global` as reserved app-location keywords for framework permissions.
5. Evaluate and grant by `permissions.key`; `role_permissions.permission_key` references it directly.

## Data Flow

### Create/list/update document during compatibility slice

```text
service input: tenantId + collection string
  -> registry validates code schema for default app + collection
  -> catalog resolver finds default app and collection_id
  -> tenant_app enablement validated/ensured
  -> repository query/write scoped by tenant_id + app_id + collection_id
  -> service returns StoredDocument with existing collection string plus optional future app metadata
```

### Permission sync

```text
registry app-aware collection declarations
  -> derive structured permission definitions
  -> resolve app/collection ids
  -> validate built-in CRUD ids are not overridden
  -> generate canonical permission keys
  -> upsert permissions by unique key
```

### Capability evaluation during compatibility slice

```text
canonical capability key input
  -> validate permissions.key exists
  -> join role_permissions by permission_key
  -> evaluate scope closure as today
```

## Migration Plan

### Slice 1: Catalog schema and default app plumbing

- Add `apps`, `tenant_apps`, and `collections` Kysely table types.
- Add baseline migration tables/indexes.
- Add a default app key constant.
- Add catalog repository helpers to ensure default app and registered collections.
- Keep documents and permissions unchanged in this slice if needed.

### Slice 2: Document identity cutover

- Add `app_id` and `collection_id` to documents.
- Backfill default app and collection rows for registered collections.
- Update repository queries/writes to use `tenant_id + app_id + collection_id`.
- Retain `collection` temporarily for API compatibility and result display.
- Update remote identity uniqueness to include app/collection ids.

### Slice 3: Structured permission identity

- Add nullable `app_id`, nullable `collection_id`, and non-null `capability_id` to permissions.
- Make `permissions.key` the primary key; remove `permission_id` from the target model.
- Change `role_permissions` to store `permission_key` and reference `permissions(key)` directly.
- Update permission derivation to emit fixed built-in CRUD capability ids and custom `action-<id>` capability ids.
- Update auth repository sync/validation/grant/evaluation to use canonical permission keys directly.

### Slice 4: Public API cleanup and docs

- Decide whether to expose app-aware document input now or keep default-app-only public API.
- Update docs and Trellis specs.
- Remove obsolete string-only assumptions from docs/tests.
- If all callsites are app-id aware, remove `documents.collection`; otherwise keep it as denormalized compatibility metadata with an explicit deprecation note.

## Risks

- Partial cutover could leave documents keyed by app/collection ids while permissions still use legacy keys. Avoid by sequencing issue #1 and #3 under one task.
- Service API compatibility can hide catalog enablement errors. Tests must cover tenant without enabled app.
- Canonical permission keys include UUIDs, so UX should format human-friendly labels from joined app/collection/capability metadata instead of trying to make `permissions.key` pretty.
- pgLite support for partial indexes and FK constraints must be verified by migration tests.

## Rollback Shape

The safest rollback before public API exposure is to keep compatibility columns during the first implementation:

- `documents.collection` remains populated while `app_id`/`collection_id` are introduced.
- Legacy permission keys can be kept only as migration input; new rows should use canonical `permissions.key` values.
- Default app rows can be dropped only if no migrated rows depend on them; otherwise rollback is a database restore/migration rollback, not an in-place toggle.
