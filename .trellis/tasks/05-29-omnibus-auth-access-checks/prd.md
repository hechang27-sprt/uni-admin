# Omnibus Auth Access Checks

## Goal

Make `AuthRbacService.checkAccessMany` the single service-level entry point for
actor membership, tenant-bound id validity, permission-key validity, and
capability authorization. Call paths that require auth/permission checks should
compose one omnibus check instead of issuing separate `assertAdminAccess`,
`checkCapabilities`, `findDeniedRolePermission`, or document authorizer calls.

## Confirmed Facts

- `AuthRbacService` implements `DocumentAuthorizer`, and document protected
  operations already call `authorizer.checkAccessMany(...)` once per logical
  batch operation.
- `server/auth/repository.ts` currently contains both omnibus
  `checkAccessMany(...)` and lower-level capability SQL.
- Auth service methods still perform separate auth checks in several paths:
  admin checks, grant permission escalation checks, delegated assignment checks,
  and scalar `checkAccess`.
- Document service protected create/read/update/delete paths use
  `DocumentAuthorizer.checkAccessMany(...)`, but that interface currently
  returns `boolean[]`, not first-failure details.
- Existing repository patterns report the first ordered actionable failure,
  rather than all invalid ids or all denied capabilities.
- Trusted/internal document writes still need tenant-scope validation even when
  no actor is present.
- Scope-listing APIs need membership and permission-key validation even when
  they return a list of accessible scopes rather than checking one target
  scope.
- Document repository writes should not perform auth-scope id validity checks;
  document service methods validate non-null auth scopes before persistence.

## Requirements

- Move omnibus check orchestration to `server/auth/service.ts`.
- Keep repository helpers focused on database facts and permission SQL, for
  example:
  - active tenant membership lookup
  - tenant-bound role/scope/assignment/document id validation
  - permission-key validation
  - capability authorization against assignments, role permissions, and scope
    closure
  - delegated role permission denial lookup when still needed as a helper
- Replace auth-service call paths that currently perform separate auth and
  permission checks with `AuthRbacService.checkAccessMany`.
- Replace document-service protected authorization calls so they use the
  omnibus `DocumentAuthorizer.checkAccessMany` contract.
- Preserve caller-order semantics:
  - protected read batches still return `null` for denied positions
  - protected mutation/create batches still reject on the first denied item
  - id/permission/capability validation reports the first actionable failure
- Preserve trusted/internal behavior:
  - no actor options means trusted document operations remain allowed
  - repository/service must still reject invalid cross-tenant auth scopes for
    trusted document writes
- Keep repository mutation methods safe unless the service has already absorbed
  the same check without reducing direct repository safety.
- Update server specs to capture the service-owned omnibus auth boundary.

## Acceptance Criteria

- [ ] `AuthRbacService.checkAccessMany` owns omnibus orchestration and no longer
      delegates the whole check to repository `checkAccessMany`.
- [ ] Repository exposes lower-level helper methods instead of the omnibus
      service contract.
- [ ] `grantPermissionAsActor`, `assignRoleAsActor`, `assertAdminAccess`,
      scalar `checkAccess`, and document-service protected authorization flow
      rely on the omnibus check path.
- [ ] Delegated assignment escalation is checked in the same logical omnibus
      call path as owner/admin authorization.
- [ ] Document protected batch tests continue to observe one authorizer
      `checkAccessMany` call per logical document operation.
- [ ] Existing auth/RBAC behavior tests pass, with expectations updated where
      repository helper names or call counts change.
- [ ] `npm run typecheck` passes.
- [ ] Relevant server specs document the final service/repository boundary.

## Out Of Scope

- Adding Nuxt routes, composables, or UI.
- Changing database schema or migrations.
- Changing collection permission naming conventions.
- Removing trusted/internal document operation behavior.

## Open Questions

- None blocking. Recommended implementation preserves repository-level
  persistence safety for mutation methods while moving actor-specific omnibus
  orchestration to the service.
