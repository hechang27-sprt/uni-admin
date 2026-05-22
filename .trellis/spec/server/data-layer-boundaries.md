# Data Layer Boundaries

The current MVP focuses on the server document data layer. Keep boundaries
clear so future routes, composables, and generated UI can build on stable
contracts.

## Module Ownership

- `server/data/documents/types.ts` owns framework-level JSON, document,
  filtering, sorting, pagination, and error-code types.
- `server/data/documents/errors.ts` owns `DocumentServiceError` and
  `isDocumentServiceError`.
- `server/data/documents/registry.ts` owns collection registration and
  collection lookup.
- `server/data/documents/json-patch.ts` owns the supported JSON Patch subset.
- `server/data/documents/remote.ts` owns remote adapter and projection-mapper
  contracts.
- `server/data/documents/service/` owns service contracts, implementation, and
  service helper functions.
- `server/data/documents/repository/` owns repository contracts, query
  normalization/builders, and Drizzle persistence.
- `server/data/documents/index.ts` re-exports the public surface.

## Public Surface

Add exports through the closest module barrel first, then through
`server/data/documents/index.ts` only when the symbol is part of the framework
surface. Current examples:

- Repository exports flow through `repository/index.ts`.
- Service exports flow through `service/index.ts`.
- Consumers import framework primitives from `#server/data/documents` in tests
  or `../server/data/documents` in docs.

## Boundary Rules

- The service validates collection existence and document data before writing.
- Repository methods assume normalized persistence inputs and preserve tenant
  scoping.
- Remote adapters own remote API calls and payload validation; the service owns
  local projection persistence.
- Normal reads (`getById`, `getByIds`, `list`) read local projections only.
- Future Nuxt API routes and composables should call service methods rather
  than reaching into repository or adapter internals.

## Anti-Patterns

- Do not let custom action code mutate database rows directly; use the document
  service projection/write path.
- Do not put remote API calls inside Drizzle transactions.
- Do not bypass `CollectionRegistry` or Zod schemas before persistence.
- Do not import private service helpers as application API.
