# Rewrite document scope filtering without document-mode branch

## Goal

Remove the `DocumentService.list()` branch that special-cases `auth.resourceScope === "document"`, and replace the nullable bottom-scope model with a physical bottom-scope sentinel (`00000000-0000-0000-0000-000000000000`) so repository/query authorization and document metadata stop overloading `null`.

## What I already know

- `DocumentService.list()` currently branches: `document` mode computes `grantedDocumentFilterScopeIds`, while `tenant-root` and `none` call `evaluateAccess(...)` directly before listing.
- The current RBAC model still uses nullable scope ids in role assignments, capability checks, and some document metadata paths.
- The archived issue-4 task designed bottom scope as a virtual child of every concrete scope but represented it with `null`; the user now wants a physical sentinel scope id instead.
- `authScopes` and `authScopeClosure` currently contain only real tenant scopes plus ordinary closure rows; `createScope()` inserts closure rows from ancestors plus the self-row.
- The user chose a full sentinel cutover: `documents.auth_scope_id` must migrate off `null` in this task too.
- The user further clarified that with a physical bottom scope, scope ids in both DB and code should become non-nullable again.
- Tenant-root ids should always be represented with actual UUIDs in both inputs and outputs; no aliases.
- The canonical system/global tenant id for the global bottom-scope row should also use the all-zero UUID `00000000-0000-0000-0000-000000000000`.
- Existing tests already cover list filtering, tenant-root translation, document-null translation for writes, and bottom-scope isolation.

## Requirements

- `DocumentService.list()` must stop branching on `auth.resourceScope === "document"`.
- The service must call `authorizer.listGrantedScopesForCapability({ context, capability })` directly for actor-scoped protected lists.
- The direct grant data passed into `DocumentRepository.list()` must be enough for the repository/query layer to apply the correct read filter for `document`, `tenant-root`, and `none` collection auth modes.
- Replace nullable bottom-scope semantics with a physical sentinel scope id `00000000-0000-0000-0000-000000000000`.
- `authScopes` and `authScopeClosure` must physically represent the bottom scope so it is a descendant of every concrete scope.
- Scope ids in DB contracts and application code must become non-nullable again for the changed paths; bottom is represented by the sentinel id, not by `null`.
- Tenant-root scope ids must always use the real tenant root UUID in code and persisted document metadata; omission/defaulting must normalize to that UUID rather than to `null`.
- Repository/service authorization code must stop using `null` as the bottom-target sentinel in this cutover.
- `documents.auth_scope_id` must also migrate off `null` in this task; tenant-root and bottom document semantics must be represented explicitly under the sentinel-based model.
- Mutation authorization paths must be updated as needed to keep the full sentinel model coherent; do not preserve a split model where reads use the sentinel but writes or document metadata still depend on `null` bottom semantics.
- No compatibility shim helpers or parallel list APIs.

## Acceptance Criteria

- [ ] `DocumentService.list()` no longer contains a branch on `auth.resourceScope === "document"`.
- [ ] Protected list reads call `listGrantedScopesForCapability(...)` and pass direct grant rows into repository list filtering.
- [ ] Repository/query code applies read filtering from direct grant rows and `resourceScope` instead of the old `grantedDocumentFilterScopeIds` helper contract.
- [ ] Bottom-scope authorization no longer depends on `null` target or assignment semantics in the changed paths.
- [ ] `documents.auth_scope_id` no longer depends on `null` bottom/tenant-root overloading in the changed paths.
- [ ] Scope-id types and persisted assignment/document scope columns are non-nullable again where this cutover owns them.
- [ ] Schema/migration and RBAC code physically represent bottom scope through the sentinel id and closure rows.
- [ ] Auth/RBAC tests cover the sentinel bottom-scope behavior, including document metadata behavior, without weakening existing mode-distinction assertions.

## Out of Scope

- Introducing a second bottom-scope identifier or mixed sentinel/null compatibility layer.
- Unrelated API renames beyond what the repository/service/schema contract needs for this rewrite.

## Technical Notes

- Current active task remains `.trellis/tasks/06-18-rewrite-document-scope-filtering/`; the user changed the design rather than creating a new task.
- Relevant files now likely include `server/db/schema.ts`, `server/db/migrations/001-baseline.ts`, `server/auth/um/repository.ts`, `server/auth/um/types.ts`, `server/data/documents/service/service.ts`, `server/data/documents/repository/kysely.ts`, `server/data/documents/repository/query.ts`, `server/data/documents/types.ts`, and `test/unit/server/auth-rbac.test.ts`.
- Archived task `.trellis/tasks/archive/2026-06/06-16-issue-4-resource-scope-none-db/` used `null` as bottom-scope storage; that plan is superseded for this task.
- The system/global tenant-id choice is now settled: use the all-zero UUID as the canonical global/system tenant id for the global bottom-scope row.
