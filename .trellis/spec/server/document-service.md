# Document Service

`createDocumentService` in `server/data/documents/service/create-service.ts` is
the main server API for the current framework.

## Local Operations

The service supports:

- `create` and `createMany`
- `getById` and `getByIds`
- `list`
- `update` and `updateMany`
- `patch`
- `softDelete`, `restore`, and `hardDelete`

Follow the existing contract types in
`server/data/documents/service/contracts.ts` when adding or changing service
methods.

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
- Use `assertVersionAndUpdate` for single-document versioned updates where it
  fits.
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
