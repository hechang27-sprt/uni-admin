# Design: Express `resourceScope: "none"` in DB

## Problem

Issue #4 asks for bottom-scope RBAC grants. Today every role assignment has `user_role_assignments.scope_id not null`, and every granted permission query joins through `auth_scope_closure`. That means the database can express grants at concrete scopes in the tenant tree, but cannot express a role grant at the virtual bottom scope beneath all concrete scopes.

## Decision

Implement `resourceScope: "none"` as an explicit third authorization mode backed by a virtual bottom scope. Persist explicit bottom-scope assignments as `user_role_assignments.scope_id = null`.

This is the clean cutover because it keeps the existing scope tree authoritative for concrete resources and does not introduce a fake scope row. Null means “bottom scope,” not “tenant root.” Because bottom is effectively a child of every concrete scope in the tenant, any concrete scoped grant can flow down to a `resourceScope: "none"` check, while a null/bottom assignment cannot flow upward to tenant-root or document scopes.

## Impact / blast radius

GitNexus impact checks during planning:

- `selectGrantedPermissions` (`server/db/query.ts`) — LOW risk; 3 direct repository callers: `checkCapabilities`, `listAccessibleScopeIds`, `listGrantedScopeIdsForCapability`; affected process label includes `checkCapabilities`.
- `KyselyAuthRbacRepository.assignRoles` (`server/auth/um/repository.ts`) — LOW risk; indexed direct callers not detected for concrete method, but interface/service wrappers must still be inspected.
- `resolveCollectionActionAuth` (`server/data/collections/registry.ts`) — LOW risk; direct test caller only.

## Data model

- `user_role_assignments.scope_id` becomes nullable.
- Nullable FK still references `auth_scopes.scope_id` for concrete scoped assignments.
- `scope_id = null` represents an explicit bottom-scope assignment.
- Replace existing uniqueness with null-aware uniqueness:
  - scoped: unique `(tenant_id, user_id, role_id, scope_id)` where `scope_id is not null`
  - bottom: unique `(tenant_id, user_id, role_id)` where `scope_id is null`
- Update `UserRoleAssignmentsTable.scopeId` and role-assignment input types to `string | null`.

## Permission auth metadata persistence

User clarification: `scopeMode` / resource-scope mode is not document metadata. It is declared on the collection schema and currently resolved from the in-memory `CollectionRegistry`; registry sync persists collections and permissions, but not operation/action auth metadata.

Best fit: store resolved `resource_scope` on the existing `permissions` row instead of adding a separate `collection_auth` table.

Why `permissions` is the better home:

- Each collection operation/action auth declaration already becomes a permission row via `CollectionRegistry.derivePermissionDefinitions()` and `AuthRbacService.syncCollectionPermissions()`.
- `permissions` already stores `app_id`, `collection_id`, `capability_id`, and `source`, which identify the collection capability whose auth mode is being described.
- `checkCapabilities` and role-permission joins already load `permissions`; adding `resource_scope` there avoids another join and keeps auth metadata colocated with the permission it constrains.
- Disabled auth declarations (`false`) already omit permission definitions; no separate cleanup table is needed beyond existing permission sync semantics.

Proposed `permissions` addition:

- `resource_scope text null` with values `document`, `tenant-root`, `none` for collection-sourced permissions.
- Null for non-collection/admin permissions whose target mode is supplied by explicit service/repository checks rather than collection schema.
- Optional check constraint: `resource_scope in ('document', 'tenant-root', 'none')` when non-null.

Sync behavior:

- Extend `PermissionDefinitionInput` / resolved permission values with optional `resourceScope`.
- `CollectionRegistry.derivePermissionDefinitions()` should include the resolved resource scope for each operation/action permission.
- `upsertPermissions()` should insert/update `permissions.resource_scope` along with app/collection/capability/source/description.

Why not store this on documents: `resourceScope` describes how a collection capability is authorized, not the target document. A document only stores its concrete `auth_scope_id`; permission metadata tells the service/repository whether a capability checks document, tenant-root, or bottom.

## Authorization model

Supported collection auth modes become:

- `"document"` — existing behavior; check permissions at document auth scopes, with document `authScopeId: null` normalized to tenant root.
- `"tenant-root"` — existing behavior; check permission at tenant root.
- `"none"` — new behavior; check the virtual bottom scope. Grants assigned at any concrete tenant scope can satisfy the check because bottom is below every concrete scope; grants assigned at bottom (`scope_id = null`) also satisfy bottom checks.

Important invariant: tenant-root and bottom are not interchangeable. Current repository code normalizes input `'null'` to tenant root, so implementation must introduce an explicit distinction before SQL evaluation. Recommended shape: access-check internals carry target kind/scope mode rather than relying on `(string | null)[]` alone. Bottom-scope grants must not authorize upward into tenant-root/document scopes.

## Query model

Refactor `selectGrantedPermissions()` / capability evaluation so concrete scoped grants can match the virtual bottom target without making bottom grants match concrete targets.

Recommended shape:

- scoped branch: current joins through `auth_scope_closure`, yielding concrete descendant scope rows for ordinary document/tenant-root checks.
- bottom-target handling: for `resourceScope: "none"` checks, treat every concrete scoped assignment for that tenant/user/role/permission as applicable because bottom is a child of every concrete scope.
- bottom-assignment branch: rows where `assigned.scopeId is null` apply only to the bottom target, never to concrete descendant scopes.

Repository methods that list accessible document scopes should ignore bottom-scope rows. Repository methods that list granted scopes may return null only when the caller is intentionally asking for explicit bottom grants, not as a tenant-root alias.

## Service integration

- Extend collection registry validation/types to accept `resourceScope: "none"` while keeping default `"document"`.
- In document service authorization helpers, branch explicitly for all three modes.
- `listCreatableScopes` for `"none"` should not return document scopes as if they were selectable resource scopes. Preferred behavior: authorize the bottom-scope create capability and return `[null]` only if the public API intentionally uses `null` to mean “bottom/no selectable document scope”; otherwise return `[]` after authorization. Implementation should document whichever public behavior is chosen.

## Null-to-root normalization evaluation

Recommendation: remove the repository-level normalization behavior that turns `targetScopeIds: [null]` into the tenant root scope id. It is possible, and it improves the issue #4 data model by reserving `null` for the virtual bottom scope instead of making it context-dependent.

Current behavior lives in `KyselyAuthRbacRepository.checkCapabilities`: `scope_input.target_scope_id = 'null'` is coalesced to `rootScopeId`, and missing-cap output carries `isRootScope` so service errors can map it back to public `null`. This is an implementation quirk, not a necessary data-model rule.

Clean replacement:

- Change access-check input from nullable target ids to explicit target modes, for example `{ scopeMode: "scope", scopeId: string } | { scopeMode: "tenant-root" } | { scopeMode: "bottom" }`.
- Keep `documents.auth_scope_id = null` as persisted document metadata meaning “tenant-root document”. Translate that at the document-service boundary into `scopeMode: "tenant-root"`, not into a nullable scope id.
- Keep `user_role_assignments.scope_id = null` as persisted grant metadata meaning “explicit bottom-scope assignment”.
- In SQL, tenant-root checks should compare against the real root scope id only after the input mode says `tenant-root`; bottom checks should use the virtual bottom target and should match concrete scoped grants plus explicit bottom grants.

Effect on current design:

- Positive: removes the main ambiguity between tenant-root and bottom scope.
- Positive: makes bottom-scope semantics compatible with `scope_id = null` without overloading public `targetScopeIds`.
- Required migration in code, not data: callers that currently pass `[null]` for tenant-root must pass an explicit tenant-root mode. Existing document rows with `auth_scope_id = null` and existing root scope rows do not need data migration.
- Public API caution: if `listCreatableScopes()` continues returning `null` for tenant-root documents, that public return value can stay as a document-auth-scope convention, but it should be translated before authorization and not leak into repository evaluation as a nullable target id.

## Migration / rollback

Forward migration:

1. Add nullable `permissions.resource_scope` with allowed values `document`, `tenant-root`, and `none`.
2. Backfill/sync `permissions.resource_scope` from registered collection permissions during normal permission sync.
3. Drop old `user_role_assignments_unique` index.
4. Alter `user_role_assignments.scope_id` to drop `not null`.
5. Create scoped partial unique index.
6. Create bottom-scope partial unique index.

Rollback:

1. Drop `permissions.resource_scope`.
2. Delete or reject rows where `scope_id is null` before restoring `not null`; rollback should fail loudly if data would be lost unless a deletion is explicitly chosen.
3. Drop partial indexes.
4. Restore `scope_id not null` and original unique index.

## Tests

Add/adjust pgLite-backed unit coverage in `test/unit/server/auth-rbac.test.ts`:

- Registry accepts operation/action `resourceScope: "none"`.
- Concrete scoped role assignment authorizes a `resourceScope: "none"` capability.
- Null/bottom-scope role assignment authorizes a `resourceScope: "none"` capability.
- Null/bottom-scope role assignment does not authorize document or tenant-root checks.
- Existing document and tenant-root authorization tests remain green.
- Migration/schema tests prove nullable `scope_id` and null-aware uniqueness.

## Research references

- `research/schema-and-query-surface.md`
- `research/resource-scope-none-semantics.md`
