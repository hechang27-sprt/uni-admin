# Data Layer Boundaries

The current MVP focuses on the server document data layer. Keep boundaries
clear so future routes, composables, and generated UI can build on stable
contracts.

## Module Ownership

- `server/data/documents/types.ts` owns framework-level JSON, document,
  filtering, sorting, pagination, and error-code types.
- `server/data/documents/errors.ts` owns `DocumentServiceError` and
  `isDocumentServiceError`.
- `server/data/collections/` owns app-aware collection registration,
  collection lookup, and collection permission derivation.
- `server/data/catalog/` owns persisted app, tenant-app, and collection catalog
  identity plus tenant app enablement helpers.
- `server/data/documents/json-patch.ts` owns the supported JSON Patch subset.
- `server/data/documents/remote.ts` owns remote adapter and projection-mapper
  contracts.
- `server/data/documents/service/` owns service contracts, implementation, and
  service helper functions. It is the boundary that resolves public
  `{ appKey?, collection }` input to catalog `appId + collectionId` before
  persistence.
- `server/data/documents/repository/` owns repository contracts, query
  normalization/builders, and Kysely document persistence.
- `server/data/documents/index.ts` re-exports the public document data surface.

## Public Surface

Add exports through the closest module barrel first, then through
`server/data/documents/index.ts` only when the symbol is part of the framework
surface. Current examples:

- Catalog exports flow through `server/data/catalog/index.ts`.
- Repository exports flow through `repository/index.ts`.
- Service exports flow through `service/index.ts`.
- Consumers import document framework primitives from `#server/data/documents`
  in tests or `../server/data/documents` in docs.

## Interface Shape Convention

### 1. Scope / Trigger

- Trigger: adding or changing related service/repository operations that share
  the same resource, filters, authorization path, or result shape.
- Prefer one cohesive interface with explicit parameters over multiple sibling
  methods whose semantics can drift.

### 2. Signatures

```ts
// Prefer a single query surface with extension fields.
interface ListDocumentServiceInput extends CollectionDocumentInput, ListDocumentsInput {
  operation?: CollectionOperation;
}

async list<TData extends JsonObject>(
  input: ListDocumentServiceInput,
  options?: DocumentServiceOptions,
): Promise<ListDocumentsResult<TData>>;
```

### 3. Contracts

- The owning service defines one public operation for one conceptual behavior.
- Optional fields extend the operation when they preserve the same invariants:
  tenant/app scoping, collection lookup, authorization, validation, pagination,
  sorting, and error handling.
- Callers may shape returned data locally when the shape is view-specific, such
  as mapping list results into a single item or positional `null`s.
- Do not introduce a new method solely to bake in one filter, one authorization
  operation, or one result shape when the existing method can express it.

### 4. Validation & Error Matrix

- Shared interface rejects invalid input at the same boundary as the base
  operation.
- Authorization uses the same service path; extension fields choose parameters,
  not a separate enforcement implementation.
- Missing resources follow the base operation's result contract rather than a
  helper-specific convention.

### 5. Good/Base/Bad Cases

- Good: add `operation?: CollectionOperation` to `list` so callers can reuse
  list access filtering for `read`, `update`, or another collection operation.
- Base: use `list({ ids })` for batch id lookup and let callers derive ordering
  or scalar values.
- Bad: keep `list`, `getByIds`, and `filterAccessibleDocuments` as separate
  public/private paths with subtly different authorization and missing-item
  semantics.

### 6. Tests Required

- Test the shared interface covers the old special cases before deleting helper
  methods.
- Test extension fields at the behavior boundary, not by snapshotting private
  helper calls.
- Search for removed helper names and exported contract names after the cutover.

### 7. Wrong vs Correct

#### Wrong

```ts
await service.getByIds({ tenantId, collection, ids });
await service.filterAccessibleDocuments(input, options, "update");
```

#### Correct

```ts
const result = await service.list({
  tenantId,
  collection,
  ids,
  operation: "update",
}, options);
```

Use a new method only when the behavior is a distinct domain command with a
different lifecycle or invariants, not just a narrower spelling of the same
query.

## Boundary Rules

- The registry validates safe app, collection, action, and definition keys.
- The catalog module persists app/collection identity and tenant app enablement;
  document/auth repositories must not scatter catalog lookup SQL.
- The service validates collection existence, tenant app enablement, and
  document data before writing.
- Repository methods assume normalized persistence inputs and preserve tenant,
  app, and collection scoping.
- Remote adapters own remote API calls and payload validation; the service owns
  local projection persistence.
- Normal reads (`list`) read local projections only.
- Future Nuxt API routes and composables should call service methods rather
  than reaching into repository or adapter internals.

## Anti-Patterns

- Do not let custom action code mutate database rows directly; use the document
  service projection/write path.
- Do not put remote API calls inside Kysely transactions.
- Do not bypass `CollectionRegistry` or Zod schemas before persistence.
- Do not bypass `CatalogService`/`CatalogRepository` when resolving app or
  collection ids.
- Do not import private service helpers as application API.
