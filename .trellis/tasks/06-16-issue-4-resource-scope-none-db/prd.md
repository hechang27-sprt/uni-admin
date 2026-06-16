# Express `resourceScope: "none"` in database grants

## Goal

Allow the RBAC database model to represent the virtual bottom scope used by permissions whose catalog/resource configuration opts out of ordinary scope-based management (`resourceScope: "none"`). A `scope_id = null` grant represents that bottom scope, which is effectively a child of every concrete scope in the tenant.

## What I already know

- GitHub issue #4 is open and requests database support for non-scope-based permission grants.
- Current issue proposal: allow `user_role_assignments.scope_id` to be null; null represents the virtual bottom scope / no-resource scope.
- `resourceScope: "none"` should evaluate against that bottom scope, so grants from any concrete tenant scope can flow down to it, while bottom-scope grants must not flow upward into tenant-root or document scopes.
- Existing indexed symbols point to these likely areas: `server/db/schema.ts`, `server/db/migrations/001-baseline.ts`, `server/auth/um/types.ts`, `server/auth/um/repository.ts`, `server/auth/um/service.ts`, `server/db/query.ts`, `server/data/collections/registry.ts`, and `test/unit/server/auth-rbac.test.ts`.

## Requirements

- Add first-class support for collection auth declarations with `resourceScope: "none"`.
- Represent bottom-scope role assignments as `user_role_assignments.scope_id = null`.
- Treat `resourceScope: "none"` as a bottom-scope permission check: concrete scoped grants can satisfy it because bottom is a child of all tenant scopes, but bottom-scope grants must never authorize `"document"` or `"tenant-root"` resources.
- Keep existing scoped role assignments, tenant-root authorization, and document authorization behavior unchanged.
- Update schema, migration, Kysely types, repository assignment inputs, persisted collection auth metadata, permission query/evaluation, and document service auth branching as one clean cutover.
- Use null-aware uniqueness so duplicate no-scope assignments are impossible.
- Persist collection operation/action auth metadata on the synced `permissions` row so authorization can derive target mode from catalog-backed permission metadata instead of relying only on in-memory collection schemas.

## Acceptance Criteria

- [ ] Schema and migrations allow `user_role_assignments.scope_id` to be null while preserving FK validation for non-null scopes.
- [ ] Role assignment APIs accept `scopeId: string | null` and persist null-scope assignments.
- [ ] `resourceScope: "none"` is accepted in collection auth declarations for built-in operations and custom actions.
- [ ] `resourceScope: "none"` checks are authorized by applicable concrete scoped grants and by explicit bottom-scope grants.
- [ ] Bottom-scope assignments do not authorize tenant-root or document/child-scope checks.
- [ ] Tenant-root and document/child-scope authorization behavior remains unchanged for scoped resources.
- [ ] Existing document and tenant-root RBAC tests remain green.
- [ ] Migration/schema tests cover nullable `scope_id` and null-aware uniqueness.
- [ ] Synced permission rows store collection operation/action auth resource-scope mode, including `"none"`.

## Technical Approach

Use `scope_id = null` as the persisted bottom-scope grant representation. Add `"none"` as an explicit collection resource scope mode, persist resolved `resourceScope` on each synced collection permission row, then carry an explicit bottom-scope check path through service/repository authorization. Split granted-permission query behavior into ordinary scope-closure rows plus a virtual bottom-scope target that is considered a descendant of every concrete scope.

See `design.md` for the detailed data/query/service design and `implement.md` for the implementation sequence.

## Definition of Done (team quality bar)

- Tests added/updated for null-scope assignment and authorization behavior.
- Lint / typecheck / CI green.
- Docs/notes updated if behavior changes.
- Rollout/rollback considered for schema migration risk.

## Out of Scope (explicit)

- Introducing a new authorization model beyond `resourceScope: "none"` support.
- Replacing RBAC roles, permissions, or catalog action auth semantics.
- Implementing issue #4 in this planning task.

## Technical Notes

- Source issue: https://github.com/hechang27-sprt/uni-admin/issues/4
- GitNexus query: `user_role_assignments scope_id resourceScope none permissions role assignments RBAC` surfaced `KyselyAuthRbacRepository.assignRoles`, `AuthRbacService.bootstrapTenantOwner`, `selectGrantedPermissions`, and collection registry auth resolution as likely touchpoints.
