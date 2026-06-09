Problem: `ymomvtqormuz` is not a Git rev here; this repo is jj-managed. I compared `ymomvtqormuz` → current `@`.

Base:

- `ymomvtqormuz b222fc3d3823 feat(db): add app catalog foundation`

Current:

- `@ nrpyxlwm ba6b0a9a476e`
- Working copy has no changes.
- Current change is empty; parent is `pwspyslx 90481a67 chore: record journal`.

## Change sequence

From `ymomvtqormuz` to current:

1. `xsqyqozzrzlo` — `chore: record journal`
2. `mqzkklprpotm` — `feat(data): add app-aware collection registry metadata`
3. `spqplmunkpzr` — `chore: record journal`
4. `tqrvprkwmxmv` — `feat(data): add catalog persistence helpers`
5. `kkqnvmszzoxx` — `chore: record journal`
6. `nvrqtulwpmmo` — `feat(data): scope documents by catalog identity`
7. `qnovmyrqtstp` — `chore: record journal`
8. `oqvuxvonqsoq` — `refactor(data): split catalog service and repository`
9. `mxkzmwstrvsy` — `chore: record journal`
10. `vquotpmqsyxr` — `docs(trellis): capture Nuxt server import`
11. `qrowrxvwxxxv` — `refactor(auth): key permissions by catalog identity`
12. `kwrwxkpmrlpy` — `chore: record journal`
13. `xxryzuyxxsnt` — `docs(data): record catalog identity contracts`
14. `pwspyslxqxqp` — `chore: record journal`
15. `nrpyxlwmloqr` — current empty working copy change

## High-level direction

The branch moved from “catalog tables exist” to “catalog identity is wired through documents, permissions, DI, tests, and docs.”

The main architectural change: documents and permissions are no longer identified only by tenant + collection string. They now carry catalog identity:

- app identity: `appId`, `appKey`
- collection identity: `collectionId`, `collectionKey`
- permission identity: catalog-derived permission key / capability ID

This lets two apps define the same collection name, e.g. `default/tasks` and `workflow/tasks`, without remote projection, permissions, or document queries colliding.

## Files changed

### Added

- `server/data/catalog/index.ts`
- `server/data/catalog/repository.ts`
- `server/data/catalog/service.ts`

### Modified core code

- `server/db/schema.ts`
- `server/db/migrations/001-baseline.ts`
- `server/db/query.ts`
- `server/di/container.ts`
- `server/di/tokens.ts`
- `server/data/documents/index.ts`
- `server/data/documents/registry.ts`
- `server/data/documents/types.ts`
- `server/data/documents/repository/types.ts`
- `server/data/documents/repository/kysely.ts`
- `server/data/documents/service/contracts.ts`
- `server/data/documents/service/service.ts`
- `server/auth/um/repository.ts`
- `server/auth/um/service.ts`
- `server/auth/um/types.ts`

### Modified tests

- `test/unit/server/auth-rbac.test.ts`
- `test/unit/server/service.test.ts`
- `test/unit/server/util-db.test.ts`

### Modified docs/specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/server/auth-rbac.md`
- `.trellis/spec/server/data-layer-boundaries.md`
- `.trellis/spec/server/repository-and-database.md`
- `.trellis/tasks/06-08-app-catalog-identity-migration/implement.md`
- `.trellis/workspace/hechang27-sprt/index.md`
- `.trellis/workspace/hechang27-sprt/journal-1.md`
- `docs/data-layer-development-notes.md`
- `docs/framework-dx-guide.md`

## Core code walkthrough

### 1. Catalog persistence layer was introduced

New package:

```ts
server/data/catalog/
  index.ts
  repository.ts
  service.ts
```

`server/data/catalog/repository.ts` defines:

- `CatalogApp`
- `CatalogCollection`
- `EnsureCatalogAppInput`
- `EnableTenantAppInput`
- `FindCatalogCollectionInput`
- `FindTenantCatalogCollectionInput`
- `CatalogRepository`
- `KyselyCatalogRepository`

The repository now owns persistence for:

- ensuring an app exists in `apps`
- enabling an app for a tenant in `tenantApps`
- syncing registry collections into `collections`
- finding a collection by app + collection key
- finding a tenant-enabled collection by tenant + app + collection key

`server/data/catalog/service.ts` wraps that repository with app-level operations:

- `ensureDefaultApp()`
- `syncRegistryCollections()`
- `enableDefaultAppForTenant()`
- `enableTenantApp()`
- `findCollectionIdentity()`
- `findTenantCollectionIdentity()`

Decision: catalog identity moved out of document/auth logic into its own service/repository. That is cleaner than having document service manually upsert catalog tables.

---

### 2. DI now wires the catalog layer

`server/di/container.ts` now imports and binds:

- `CatalogRepository` → `KyselyCatalogRepository`
- `CatalogService` → `CatalogService`

`server/di/tokens.ts` gained catalog-related tokens.

This means document/auth code can resolve catalog identity through DI instead of directly constructing catalog repositories.

---

### 3. DB schema now carries catalog identity through documents and permissions

`server/db/schema.ts` changed the important tables:

#### `AppsTable`

Observed fields:

- `appId`
- `key`
- `name`
- `config`
- timestamps

#### `TenantAppsTable`

Observed fields:

- `tenantId`
- `appId`
- `config`
- `enabledAt`

#### `CollectionsTable`

Observed fields:

- `collectionId`
- `appId`
- `key`
- `definitionKey`
- timestamps/config fields

#### `PermissionsTable`

Changed away from generated `permissionId`.

Observed fields now include:

- `key`
- `appId`
- `collectionId`
- `capabilityId`
- `source`
- `description`
- timestamps

#### `RolePermissionsTable`

Changed from:

```ts
permissionId: string
```

to:

```ts
permissionKey: string
```

#### `DocumentsTable`

Documents now include:

```ts
tenantId: string;
appId: string;
collectionId: string;
collection: string;
```

Before this line of work, document identity was mostly tenant + collection name. Now every document row is tied to the app and collection catalog row.

---

### 4. Collection registry became app-aware

`server/data/documents/registry.ts` now exports:

```ts
export const DEFAULT_APP_KEY = "default";
```

Collection registrations gained app metadata:

- optional `appKey`
- optional `definitionKey`

Permission definitions gained catalog-aware fields:

- optional `key`
- optional `appKey`
- optional `collectionKey`
- optional `capabilityId`
- `source` now includes `"global"`

The registry now stores collections by composite registry key:

```ts
`${appKey}:${name}`
```

Observed API changes:

- `get(name)` still resolves from the default app.
- `has(name)` still checks default app.
- New app-aware variants exist:
  - `getForApp(appKey, name)`
  - `hasForApp(appKey, name)`
- `list()` returns normalized/registered collections, including app metadata.

Permission derivation now computes a permission identity from:

- app key
- collection key
- capability ID or key

That prevents permission collisions between apps that reuse the same capability/collection names.

---

### 5. Document repository is now scoped by app + collection identity

`server/data/documents/repository/kysely.ts` now requires `appId` and `collectionId` in key document operations.

Observed from `list()`:

```ts
.where("tenantId", "=", input.tenantId)
.where("appId", "=", input.appId)
.where("collectionId", "=", input.collectionId)
.where("collection", "=", input.collection)
```

Observed in remote projection upsert:

- `appId`
- `collectionId`

are part of the inserted/updated record.

The remote projection conflict key now includes catalog identity:

```ts
tenantId
appId
collectionId
remoteId
remoteSource
```

This is the big correctness fix: two apps can project the same `remoteSource` / `remoteId` without overwriting each other.

---

### 6. Auth/RBAC permissions now use permission keys instead of permission IDs

`server/auth/um/repository.ts` changed permission writes to upsert by `key`.

Observed behavior in `upsertPermissions`:

- inserts:
  - `key`
  - `appId`
  - `collectionId`
  - `capabilityId`
  - `source`
  - `description`
- conflict target:
  - `key`
- conflict update:
  - `app_id`
  - `collection_id`
  - `capability_id`
  - `source`
  - `description`
  - `updated_at`

`server/db/query.ts` also changed granted-permission joins from permission ID to permission key:

```ts
permissions.key = rolePermissions.permissionKey
```

So role permissions now reference stable derived permission keys rather than generated DB UUIDs.

This aligns RBAC with registry-derived permission identity.

---

### 7. Auth service now depends on catalog service

`server/auth/um/service.ts` now injects `CatalogService`.

Observed constructor additions:

```ts
@inject(SERVER_DI_TYPES.CatalogService)
private readonly catalog: CatalogService
```

Observed behavior:

```ts
async syncCollectionPermissions(registry: CollectionRegistry) {
  await this.catalog.syncRegistryCollections(registry);
  ...
}
```

So permission sync also syncs catalog collections first. That ensures collection-backed permission records can carry `appId` / `collectionId`.

---

### 8. Tests now cover catalog identity behavior

`test/unit/server/service.test.ts` added/changed coverage around:

- two apps using the same collection name
- tenant default app writes
- tenant non-default app writes
- remote projection identity scoped by `appId` + `collectionId`
- JSONB-path filters, metadata filters, sorting, pagination bounds, deleted inclusion

Observed test setup includes:

```ts
const catalog = container.get<CatalogService>(SERVER_DI_TYPES.CatalogService);
await catalog.syncRegistryCollections();
await catalog.enableDefaultAppForTenant(tenantA);
await catalog.enableTenantApp({ tenantId: tenantA, appKey: "workflow" });
```

Then it resolves identities with:

```ts
catalog.findTenantCollectionIdentity({
  tenantId,
  appKey,
  collectionKey: "tasks",
})
```

and inserts documents carrying:

- `tenantId`
- `appId`
- `collectionId`
- `collection`
- `schemaVersion`
- `data`
- `remoteSource`
- `remoteId`

This test is the clearest behavioral proof of the change: same collection name and same remote ID can exist under different app identities.

---

## Main behavioral impact

Before this range:

- collection names were effectively global-ish within tenant/document logic
- permissions were keyed around generated permission IDs
- remote document projection could collide when apps shared collection names/remote IDs

After this range:

- app + collection catalog identity flows through:
  - registry
  - catalog persistence
  - document rows
  - remote projection upserts
  - RBAC permission derivation
  - role permission joins
- default app remains the compatibility path via `DEFAULT_APP_KEY = "default"`
- non-default apps can be tenant-enabled and safely use overlapping collection names

## Mental model after the change

Think of collection access as:

```text
tenant
  -> enabled app
    -> catalog collection
      -> documents
      -> derived permissions
```

Not:

```text
tenant
  -> collection string
```

The new stable identity chain is:

```text
app.key + collection.key
  -> apps.app_id + collections.collection_id
  -> documents.app_id + documents.collection_id
  -> permissions.app_id + permissions.collection_id + capability_id
  -> role_permissions.permission_key
```

## Risks to watch

- Any code still constructing document repository inputs without `appId` / `collectionId` will now be incomplete.
- Any code assuming permission IDs are stable join targets must move to `permissionKey`.
- Registry callers using `get(name)` still default to the default app; non-default app callers must use app-aware lookup.
- Catalog sync must happen before permission sync or app-aware document writes, otherwise collection identity lookup can fail.

## Quick command reference

To inspect the same range locally:

```bash
jj log -r 'ymomvtqormuz::@'
jj diff --from ymomvtqormuz --to @ --stat
jj diff --from ymomvtqormuz --to @ --summary
jj diff --from ymomvtqormuz --to @ -- server/data/catalog server/data/documents server/auth/um server/db
```
