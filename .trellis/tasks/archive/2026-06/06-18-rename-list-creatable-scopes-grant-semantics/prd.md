# rename listCreatableScopes grant semantics

## Goal

Rename the misleading create-grant and document-list scope-filter APIs so they clearly distinguish direct create-capability grants from descendant-derived document access filters, and align the implementation with the settled RBAC contract.
## Requirements

- `DocumentService.listCreatableScopes()` must be renamed to a grant-oriented name.
- The renamed document-service method must return all direct grants for the collection `create` capability as `{ roleId, scopeId }` rows.
- The returned grant rows must include `scopeId = null` explicit bottom-scope grants.
- The returned grant rows must not expand descendant scopes.
- The returned grant rows must not be filtered by collection `resourceScope` mode.
- Collection `resourceScope` semantics must remain enforced only in actual create authorization.
- Misleading auth helper names that imply creatable target expansion must be renamed to match the grant-list contract.
- Names containing `accessibleScope` / `accessibleScopes` that actually mean descendant-derived document access filters must be renamed to filter-oriented terminology.
- Existing helpers that consume grant rows for document-list filtering may keep flattening to concrete scope ids where needed, but their names must make clear they represent document access filters rather than direct grants.
- Directly affected unit tests must be renamed and updated to assert the new contract and preserve current authorization behavior.
- Public exports and all callsites must be updated with no compatibility shim aliases.

## Acceptance Criteria

- [ ] No remaining `listCreatableScopes` or `listCreatableDocumentScopes` symbol remains in the codebase.
- [ ] No misleading `accessibleScope*` name remains where the value actually means a descendant-derived document access filter.
- [ ] The document-service grant-list API name communicates grant provenance rather than effective creatable targets.
- [ ] A collection with `resourceScope: "document"`, `"tenant-root"`, or `"none"` returns the same direct create grants for the same actor.
- [ ] Returned grant rows include `{ roleId, scopeId: null }` for explicit bottom-scope grants.
- [ ] Returned grant rows do not enumerate descendant scopes.
- [ ] Actual create authorization still respects `resourceScope` mode restrictions, including tenant-root-only create and bottom-scope checks.
- [ ] Document-list filtering names now distinguish grant rows from descendant-derived access filters.
- [ ] `test/unit/server/auth-rbac.test.ts` covers the renamed API contract and continues proving authorization behavior separately.
- [ ] Typecheck and the directly affected auth RBAC test suite pass.

## Out of Scope

- Changing RBAC evaluator target semantics beyond what the rename/refactor requires.
- Expanding descendant scopes into JavaScript.
- Broad API redesign of unrelated auth/document service methods.

## Technical Notes

- Settled contract from planning: `listCreatableScopes()` was a misnomer; the API should list direct grants, not effective create targets.
- `resourceScope` is document authorization metadata, not part of the grant-list contract.
- `accessibleScopeIds`-style names in the document list path are also misleading because they hold descendant-derived document access filters, not direct grant scopes.
- Relevant files: `server/data/documents/service/service.ts`, `server/data/documents/types.ts`, `server/data/documents/repository/kysely.ts`, `server/data/documents/repository/query.ts`, `server/auth/um/service.ts`, `server/auth/um/repository.ts`, `server/auth/um/types.ts`, `server/auth/um/index.ts`, `test/unit/server/auth-rbac.test.ts`.
