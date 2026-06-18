# RBAC schema and query surface for issue #4

## Scope inspected

- `server/db/schema.ts:118-125` — `UserRoleAssignmentsTable`
- `server/db/schema.ts:133-137` — nullable `DocumentsTable.authScopeId` comparison point
- `server/db/migrations/001-baseline.ts:246-267` — `user_role_assignments` table definition
- `server/db/migrations/001-baseline.ts:371-381` — assignment indexes
- `server/db/query.ts:24-46` — `selectGrantedPermissions()` join shape
- `server/auth/um/repository.ts:498-531` — `KyselyAuthRbacRepository.assignRoles()`
- `server/auth/um/repository.ts:884-926` — granted-scope read helpers built on `selectGrantedPermissions()`
- `server/utils/unnest.ts:24-33,82-118` — `unnest()` options and nullable-array typing behavior used by assignment inserts
- `.trellis/spec/server/repository-and-database.md:196-215,279-295` — repository/auth-scope guidance

## Current `user_role_assignments.scope_id` surface

### Schema and migration state

- Kysely type is currently required: `UserRoleAssignmentsTable.scopeId: string` in `server/db/schema.ts:118-125`.
- Baseline migration creates `user_role_assignments.scope_id uuid not null references auth_scopes(scope_id) on delete cascade` in `server/db/migrations/001-baseline.ts:246-267`.
- The table-level unique index is `user_role_assignments_unique` on `(tenant_id, user_id, role_id, scope_id)` in `server/db/migrations/001-baseline.ts:371-376`.
- Secondary lookup index is only `user_role_assignments_user_idx` on `(tenant_id, user_id)` in `server/db/migrations/001-baseline.ts:378-381`.
- There is no dedicated partial index, check constraint, or alternate uniqueness rule for null scope assignments because null is not currently allowed.

### Constraint implications today

- Every assignment must point at an `auth_scopes` row because the FK is non-nullable.
- Deleting a scope cascades assignment deletion because `scope_id` uses `on delete cascade`.
- The schema already has a nearby precedent for nullable scope linkage in documents: `DocumentsTable.authScopeId: string | null` and `documents.auth_scope_id` has a nullable FK in `server/db/schema.ts:133-137` and `server/db/migrations/001-baseline.ts:286-288`.

## Kysely type impacts

### Direct typing changes

If issue #4 is implemented with `scope_id = null` representing `resourceScope: "none"`, the following typed surfaces must change together:

- `server/db/schema.ts:118-125`
  - `scopeId` must become `string | null` in `UserRoleAssignmentsTable`.
- `server/auth/um/repository.ts:498-531`
  - `assignRoles()` input currently requires `scopeId: string`; this would need to accept `string | null`.
- Any row selections flowing through `assigned.scopeId` in query builders will become nullable at the type level, especially in `selectGrantedPermissions()` consumers.

### Insert helper compatibility

`assignRoles()` pivots arrays and feeds them through `unnest()` with `types: { scopeId: "uuid" }` in `server/auth/um/repository.ts:506-523`.

That is compatible with nullable values:

- `server/utils/unnest.ts:24-33` defines element typing so nullable array expressions produce nullable unnested elements.
- `server/utils/unnest.ts:82-118` only uses the `types` hint to cast the SQL array element type; it does not require non-null values.

So the insert path does not need a different batching primitive; it needs only a widened TypeScript input/output contract.

## Query assumptions around `authScopeClosure`

### Shared helper assumption

`selectGrantedPermissions()` in `server/db/query.ts:24-46` hard-requires a closure row:

- joins `userRoleAssignments as assigned`
- then joins `rolePermissions as rp`
- then joins `permissions as p`
- then `innerJoin("authScopeClosure as c")` on `c.ancestorId = assigned.scopeId` and `c.tenantId = tu.tenantId`

Current consequence:

- An assignment contributes permissions only through a concrete scoped ancestor.
- A null `assigned.scopeId` would be dropped by the inner join and contribute no rows.

### Downstream helper expectations

`KyselyAuthRbacRepository` currently stacks two read helpers on top of that shared query:

- `listAccessibleScopeIds()` in `server/auth/um/repository.ts:884-902` selects `c.descendantId as scopeId`.
- `listGrantedScopeIdsForCapability()` in `server/auth/um/repository.ts:904-926` selects `assigned.scopeId` plus `assigned.scopeId is null as isRootScope`.

Important mismatch already visible from the current code:

- `listGrantedScopeIdsForCapability()` has logic to map null assignments back to `null` in the return value.
- But because it still depends on `selectGrantedPermissions()`, a null assignment would never survive the inner join to `authScopeClosure` in `server/db/query.ts:42-45`.

That means nullable `scope_id` is not just a schema change; the shared permission-grant query shape must branch scoped vs non-scoped grants.

## Assignment insert assumptions

`assignRoles()` in `server/auth/um/repository.ts:498-531` currently assumes every assignment has a concrete scope:

- input item type is `{ userId: string; roleId: string; scopeId: string; }`
- inserted columns always include `scopeId`
- batched `unnest()` is typed as `uuid` for `scopeId`
- conflict handling is `.onConflict((oc) => oc.doNothing())`

With nullable scope support, this method can still insert the same four columns, but its assumptions change:

- `scopeId` becomes nullable in the input arrays.
- Upstream validation cannot call `findInvalidScopeId()` for null items; null must bypass tenant scope existence checks while real UUIDs still use the existing validator.
- Because the method uses `doNothing()`, uniqueness semantics matter: duplicate null-scope grants are not prevented by the current unique index in PostgreSQL.

## Uniqueness behavior for nullable `scope_id` in PostgreSQL

PostgreSQL unique indexes treat nulls as distinct values.

Applied here:

- Existing `user_role_assignments_unique` on `(tenant_id, user_id, role_id, scope_id)` would still allow multiple rows with the same `(tenant_id, user_id, role_id)` when `scope_id is null`.
- Therefore, simply dropping `not null` is not enough if the desired logical rule is “at most one unscoped assignment per tenant/user/role”.
- `.onConflict(...doNothing())` in `assignRoles()` only suppresses duplicates that hit an actual unique/index conflict. Duplicate null-scope rows would not conflict under the current index.

Recommended database shape if unscoped duplicates must be prevented:

1. Keep the existing unique index for scoped rows, ideally as a partial unique index `where scope_id is not null`.
2. Add a second partial unique index on `(tenant_id, user_id, role_id)` `where scope_id is null`.

That preserves current scoped uniqueness while enforcing a single null-scope assignment per role grant tuple.

## Recommended migration touchpoints

1. `server/db/migrations/001-baseline.ts`
   - Drop `notNull()` from `user_role_assignments.scope_id`.
   - Keep the existing FK to `auth_scopes.scope_id` so non-null values still reference a real scope.
   - Replace `user_role_assignments_unique` with two partial unique indexes:
     - scoped: `(tenant_id, user_id, role_id, scope_id)` where `scope_id is not null`
     - unscoped: `(tenant_id, user_id, role_id)` where `scope_id is null`
   - `user_role_assignments_user_idx` can stay unless later query plans show a need for a null-scope-specific index.

2. `server/db/schema.ts`
   - Change `UserRoleAssignmentsTable.scopeId` to `string | null`.

## Recommended query/repository touchpoints

1. `server/db/query.ts` — `selectGrantedPermissions()`
   - This is the central query surface that currently assumes every grant expands through `authScopeClosure`.
   - Concise implementation shape: split the helper into two grant branches and union them:
     - scoped branch: current join through `authScopeClosure`
     - unscoped branch: rows with `assigned.scopeId is null` that do not require a closure join
   - The caller should then decide whether a capability/action/resource definition may consume unscoped rows; do not broaden scoped authorization accidentally.

2. `server/auth/um/repository.ts` — `assignRoles()`
   - Widen assignment input to `scopeId: string | null`.
   - Keep the same `unnest()` batch insert pattern.
   - Ensure conflict behavior lines up with the new partial unique indexes.

3. `server/auth/um/repository.ts` — granted-scope readers
   - `listAccessibleScopeIds()` should continue to return only concrete descendant scope ids, so unscoped assignments should not invent fake descendants.
   - `listGrantedScopeIdsForCapability()` is already shaped to return `Array<string | null>`, but it currently relies on a query that filters nulls out. Its backing query must explicitly preserve unscoped rows.

4. Upstream validation path referenced by spec
   - `.trellis/spec/server/repository-and-database.md:213-215,279-295` says document service methods validate non-null `authScopeId` values through `AuthRbacService` before repository writes.
   - Recommended shape matches that contract: validate only non-null scope ids; treat null as the explicit “no scope” case rather than a missing/invalid scope.

## Concise implementation recommendation

Use `NULL` as the only database representation for `resourceScope: "none"`, with a clean cutover in three coordinated steps:

1. make `user_role_assignments.scope_id` nullable in both Kysely and the baseline migration,
2. replace the single unique index with scoped/unscoped partial unique indexes so `onConflict(...doNothing())` still deduplicates correctly,
3. refactor the shared permission-grant query so null-scope assignments do not depend on `authScopeClosure`, while keeping scoped grants on the existing closure path.

This is the smallest implementation that matches the issue’s model without introducing sentinel scopes or weakening existing scoped authorization semantics.
