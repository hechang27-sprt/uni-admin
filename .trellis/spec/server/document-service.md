# Document Service

`DocumentService` in `server/data/documents/service/service.ts` is
the main server implementation for the current framework.

## Local Operations

The service supports:

- `create` and `createMany`
- `list`
- `update` and `updateMany`
- `patch`
- `softDelete`, `restore`, and `hardDelete`

Follow contract types in
`server/data/documents/service/contracts.ts` when adding or changing service
methods.

## Unified Read Interface

### 1. Scope / Trigger

- Trigger: `DocumentService.list` is the single local read/query API. Do not add
  sibling read helpers such as `getById`, `getByIds`, or
  `filterAccessibleDocuments` when the operation can be represented as a list
  query plus caller-side shaping.

### 2. Signatures

```ts
interface ListDocumentServiceInput extends CollectionDocumentInput, ListDocumentsInput {
  operation?: CollectionOperation;
}

async list<TData extends JsonObject>(
  input: ListDocumentServiceInput,
  options?: DocumentServiceOptions,
): Promise<ListDocumentsResult<TData>>;
```

### 3. Contracts

- `ids?: string[]` narrows the list query to known document IDs.
- `operation?: CollectionOperation` overrides the default `read` authorization
  operation for access filtering; omit it for ordinary reads.
- The response is always `ListDocumentsResult<TData>` with `items`, `limit`,
  `offset`, and `hasMore`. Single-document and positional batch results are
  derived by callers from `items`.
- Normal `list` reads local projections only and must not call remote adapters.

### 4. Validation & Error Matrix

- Unknown `collection` -> `UNKNOWN_COLLECTION` from the service boundary.
- Invalid stored/created document data -> `VALIDATION_FAILED`.
- Actor lacks the selected operation capability -> denied documents are filtered
  out of `items`; tenant-root protected collections may reject with
  `AUTHORIZATION_DENIED`.
- Missing IDs -> omitted from `items`; callers that need positional `null`s build
  them from the returned set.

### 5. Good/Base/Bad Cases

- Good: `list({ tenantId, collection, ids: [id], limit: 1 })` for single-item
  lookup.
- Base: `list({ tenantId, collection, ids })` for batch reads; build a `Map` when
  preserving request order matters.
- Bad: adding a second service method with subtly different authorization,
  missing-item, or ordering semantics for the same local read path.

### 6. Tests Required

- Unit/integration tests for single-ID and multi-ID `list` queries assert item
  presence/absence and tenant/app isolation.
- Auth/RBAC tests for `operation` override assert that list access filtering uses
  the overridden capability, e.g. `operation: "update"` uses the update
  permission key.
- Remote projection tests assert ordinary `list` reads do not call remote
  adapters.

### 7. Wrong vs Correct

#### Wrong

```ts
await service.getByIds({ tenantId, collection: "tasks", ids });
await service.filterAccessibleDocuments(input, options, "update");
```

#### Correct

```ts
const result = await service.list<TaskDocument>({
  tenantId,
  collection: "tasks",
  ids,
  operation: "update",
}, options);

const byId = new Map(result.items.map((item) => [item.id, item]));
const ordered = ids.map((id) => byId.get(id) ?? null);
```

## Batch Authorization

- `createMany` and `updateMany` collect distinct target auth scopes and invoke
  `AuthRbacService.evaluateAccess(...)` once per protected operation.
- Document writes validate explicit `authScopeId` values through
  `AuthRbacService.evaluateAccess(...)` before repository persistence,
  including trusted writes without an actor and remote projection upserts.
- Omitted create/remote-create `authScopeId` values normalize to the tenant's
  real root scope id before persistence.
- `list` no longer builds a service-only document filter helper. Protected list
  reads fetch direct grant rows through `listGrantedScopesForCapability(...)`
  and pass those rows plus `resourceScope` into repository list filtering.

## Validation And Errors

- Always call `registry.get(collection)` at the service boundary so unknown
  collections fail as `UNKNOWN_COLLECTION`.
- Validate document data with the registered Zod schema before persistence.
- Wrap validation failures as `DocumentServiceError` with
  `VALIDATION_FAILED`.
- Use `DocumentServiceError` for framework failures and preserve the existing
  error-code union in `server/data/documents/types.ts`.
- Keep adapter-thrown remote errors unnormalized until the operation queue/error
  record layer exists.

## Versioning

- Existing-document mutations require `expectedVersion`.
- Stale versions fail with `CONFLICT_STALE_VERSION`.
- Use `assertVersionAndUpdate` for single-document versioned updates, passing
  the row already loaded for authorization/patching so it does not reread it.
- `updateMany` must remain all-or-nothing. It validates each existing document
  and version before calling the repository batch update, and the repository
  returns `null` if the transactional update count does not match the input.

## JSON Patch

- `patch` loads the existing document, checks `expectedVersion`, applies
  `applyJsonPatch`, validates the patched data through the collection schema,
  then writes through the same versioned update path.
- The supported JSON Patch operations are `add`, `replace`, `remove`, and
  `test`.
- Unsupported operations fail with `UNSUPPORTED_OPERATION`; failed `test`
  operations fail with `CONFLICT_PATCH_TEST_FAILED`.

## Remote Operations

- `syncRemoteOne` and `syncRemoteList` call remote adapters and upsert local
  projections.
- `remoteCreate` calls `createRemote` first, then upserts the projection.
- `remoteUpdate` loads and version-checks the local document, calls
  `updateRemote`, validates the returned projection, then updates local data
  and remote identity.
- `remoteDelete` calls `deleteRemote`, then soft-deletes the local projection;
  if the adapter returns a projection, that projection is upserted before the
  soft delete.

## Tests To Preserve

`test/unit/server/service.test.ts` covers validation, CRUD, batch behavior,
tenant isolation, filters, stale versions, JSON Patch edge cases, remote
projection sync, and remote failure ordering. Add nearby tests when changing
these service paths.

`test/unit/server/auth-rbac.test.ts` additionally covers protected batch
authorization allow/deny behavior and verifies one `evaluateAccess` call for
each collection-shaped operation.
