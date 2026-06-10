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
- Normal reads (`getById`, `getByIds`, `list`) read local projections only.
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
