# User Management Auth RBAC Implementation Plan

## Scope

Implement a service-level TypeScript MVP for username/password authentication,
relational resource-scoped RBAC, and document service authorization. Do not add
server routes, client composables, or generated UI in this task.

## Checklist

1. Read project specs before editing:
   - `.trellis/spec/guides/index.md`
   - `.trellis/spec/server/index.md`
   - any server guideline docs referenced by the index
2. Run GitNexus impact analysis before editing document service symbols or
   schema symbols.
3. Add relational auth/RBAC tables to `server/db/schema.ts`.
   - Use explicit primary key column names such as `user_id`, `scope_id`,
     `role_id`, and `permission_id`, not generic `id`.
4. Add `auth_scope_id` to `documents` plus indexes and migration.
5. Add auth/RBAC types, errors, repository contracts, and Drizzle repository
   implementation under a new server module.
6. Add a service for:
   - users and username/password credentials
   - password hashing with algorithm/parameter metadata, preferring Argon2id
     with documented fallback only if needed
   - tenant memberships
   - tenant root scope and child scopes
   - scope closure maintenance
   - roles, permissions, grants, and assignments
   - access checks and accessible scope lookup
   - trusted bootstrap setup for first tenant/root/admin
   - actor-protected admin operations for users, credentials, memberships,
     roles, grants, assignments, scopes, and document scope reassignment
   - helper queries such as creatable scopes for a collection/capability
7. Extend collection registration with auth declarations and canonical
   capability derivation.
8. Add permission sync/bootstrap from collection/action declarations.
9. Add sync/bootstrap for reserved framework admin capabilities.
10. Extend document types and repository contracts to carry `authScopeId`.
11. Add explicit document scope assignment/reassignment APIs:
    - create accepts top-level `authScopeId`
    - normal update/patch cannot change `authScopeId`
    - explicit reassignment checks current and target scopes
12. Add actor-aware document service operations that enforce:
    - create target scope checks
    - get/update/patch/delete target document checks
    - list authorization filtering
    - remote write authorization before adapter side effects
13. Keep existing service-level APIs available where appropriate for trusted
    internal/bootstrap use, or clearly split trusted and protected entrypoints.
14. Add pgLite-backed Vitest coverage for auth/RBAC and document integration
    scenarios from `prd.md`.
15. Update `docs/framework-dx-guide.md` and
    `docs/data-layer-development-notes.md` with the service-level auth/RBAC
    usage and deferred route/UI scope.
16. Run validation commands.
17. Run GitNexus change detection before commit.

## Validation Commands

```bash
bun run typecheck
bun run test
bun run build
```

## Key Tests

- Username/password user can authenticate and resolve actor context.
- Tenant A actor cannot use tenant B scopes, roles, permissions, assignments,
  or documents.
- Permission sync derives canonical collection/action capabilities and accepts
  explicit overrides.
- Tenant-root assignment grants access to `auth_scope_id = null` documents and
  descendant scoped documents.
- Child-scope assignment grants access to matching descendant documents but not
  sibling scoped documents.
- List filtering excludes inaccessible scoped documents and handles null
  `auth_scope_id` only for tenant-root access.
- Mutation checks fail before repository writes when capability or scope
  containment is missing.
- Remote update/delete fail before remote adapter calls when authorization is
  missing.
- Capability-only `resourceScope: "none"` action bypasses resource containment
  only when explicitly declared.
- Trusted bootstrap can create the first tenant root scope, first user, owner
  role, grants, and assignment.
- Actor-protected admin operations require reserved admin capabilities at the
  target scope.
- Delegated admin cannot grant roles, permissions, assignments, or scopes that
  exceed their administrable authority.
- Capability-only `resourceScope: "none"` operations still require the
  capability at tenant root.
- Removing the final effective tenant-root owner/admin assignment is rejected.
- Creating a document with `authScopeId` checks create capability at that
  scope; omitted `authScopeId` checks tenant-root access.
- Creatable scope helper returns only scopes where the actor can create the
  collection and includes tenant-root/null only when allowed.
- Normal update/patch cannot change `authScopeId`.
- Explicit document scope reassignment requires authorization for both current
  and target scopes.
- Cross-tenant scope IDs in documents, closure rows, role assignments, and
  grants are rejected by constraints or repository validation.

## Risk Points

- Migration shape for `auth_scope_id` on the existing `documents` table.
- Closure table correctness when adding child scopes.
- List query performance and SQL shape for accessible scope filtering.
- Keeping trusted bootstrap operations separate from protected user-facing
  operations.
- Ensuring authorization runs before remote side effects.
- Preventing delegated-admin privilege escalation.
- Defining first-owner bootstrap clearly enough that normal app code does not
  depend on trusted methods.
- Blocking scope deletion when documents, assignments, or descendants still
  depend on it.
- Selecting and tuning a password hashing dependency that works in the Nuxt
  server runtime and tests.
- Maintaining composite tenant/scope/role invariants in both Drizzle schema and
  service validation.

## Rollback Notes

The auth/RBAC subsystem should be added in narrow modules where possible. If
document service integration causes regressions, keep the relational auth/RBAC
services and temporarily disable protected document-service entrypoints while
restoring existing trusted document service behavior.
