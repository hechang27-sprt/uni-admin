# Remove documents collection column

## Goal

Remove the legacy `documents.collection` compatibility mirror now that document persistence has fully migrated to `tenant_id + app_id + collection_id` identity.

## What I Already Know

- `server/db/schema.ts` still types `documents.collection`.
- `server/db/migrations/001-baseline.ts` still creates `documents.collection`.
- `KyselyDocumentRepository` still writes and filters on `collection` in insert, list, update, delete, and remote-identity queries.
- `DocumentService` still passes the collection string through to repository methods even though it already resolves catalog identity first.
- `.trellis/spec/server/repository-and-database.md` still documents `documents.collection` as a temporary compatibility mirror.

## Requirements

- Remove `collection` from the `documents` table shape and baseline migration.
- Remove repository filtering/writes that still depend on `documents.collection`; scope documents only by `tenantId + appId + collectionId`.
- Keep the public service input shape unchanged: callers still pass `collection: string` so the service can resolve collection identity and validate payloads.
- Update narrow tests and server spec/docs that still describe the column as persisted state.

## Acceptance Criteria

- [ ] `server/db/schema.ts` and `server/db/migrations/001-baseline.ts` no longer define `documents.collection`.
- [ ] Document repository contracts and queries no longer require or reference a persisted `collection` column.
- [ ] Existing document service tests covering create/list/update/delete and app-scoped isolation pass without the legacy column.
- [ ] `.trellis/spec/server/repository-and-database.md` no longer describes `documents.collection` as a compatibility mirror.

## Definition of Done

- Targeted tests for document persistence and migration behavior pass.
- Touched server spec/docs match the implemented persistence model.
- `gitnexus_detect_changes()` is run before commit handoff.

## Out of Scope

- Changing public document service request shapes.
- Adding app-aware route/UI inputs.
- In-place migration scripts for already-provisioned external databases.

## Technical Notes

- Parent task: `.trellis/tasks/06-08-app-catalog-identity-migration/`.
- Likely touched files: `server/db/schema.ts`, `server/db/migrations/001-baseline.ts`, `server/data/documents/repository/{types.ts,kysely.ts}`, `server/data/documents/service.ts`, `test/unit/server/{service.test.ts,util-db.test.ts}`, `.trellis/spec/server/repository-and-database.md`.
- Need GitNexus impact analysis before editing any modified function/class/method.
