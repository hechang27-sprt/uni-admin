# move auth_scope_closure maintenance to db triggers

## Goal

Move `auth_scope_closure` maintenance fully into the database so application code no longer inserts closure rows directly when auth scopes are created. Keep the existing RBAC/document semantics unchanged while making `auth_scopes` the single write surface for scope-tree mutations.

## Requirements

- Treat `auth_scopes` as the authoritative mutation table for scope hierarchy creation.
- The database must automatically create all required `auth_scope_closure` rows for a newly inserted scope, including:
  - the self row `(scope_id, scope_id, depth 0)`
  - ancestor-to-descendant rows derived from the parent scope chain
  - the concrete-scope-to-bottom row required by bottom-scope authorization
- `KyselyAuthRbacRepository.ensureTenantRootScope()` must stop inserting into `authScopeClosure` directly.
- `KyselyAuthRbacRepository.createScope()` must stop inserting into `authScopeClosure` directly.
- Existing tenant-root, descendant-scope, and bottom-scope authorization behavior must remain unchanged.
- Deletion semantics remain DB-owned via existing foreign-key cascades; this task does not add new scope update or reparenting behavior.

## Acceptance Criteria

- [ ] After `ensureTenantRootScope(tenantId)`, the database contains the tenant-root self-closure row and no application-side closure insert is required.
- [ ] After `createScope({ parentScopeId })`, the database contains ancestor closure rows for the new scope, its self row, and its bottom row without repository-written closure inserts.
- [ ] Existing repository/service behavior for capability checks and document filtering remains green.
- [ ] pgLite-backed tests prove closure rows are trigger-owned and still support bottom-scope semantics.

## Out of Scope

- Scope reparenting or arbitrary hierarchy rewrites.
- Changing authorization semantics for tenant-root, document, or bottom targets.
- New public APIs for scope mutation.

## Technical Notes

- Current direct closure writes live in `server/auth/um/repository.ts` inside `ensureTenantRootScope()` and `createScope()`.
- Current migration trigger `maintain_bottom_scope_closure()` only inserts the concrete-scope-to-bottom row; it must expand to own all closure maintenance on insert.
- Existing test coverage already asserts bottom closure rows in `test/unit/server/auth-rbac.test.ts` and should be extended rather than replaced.
