# Implementation Plan — Rewrite document scope filtering with a physical bottom scope

## Scope

This is now a coordinated cutover:
- physical bottom-scope representation in schema + closure rows
- trigger-enforced closure invariant to bottom
- RBAC assignment/check/grant-query migration off nullable bottom semantics
- document auth metadata migration off nullable scope semantics in owned paths
- document-service list rewrite to use direct grant rows and repository-owned translation
- tests updated for sentinel bottom-scope behavior

## Ordered checklist

1. **Schema / migration plan**
   - Introduce the bottom sentinel scope id in schema-facing constants/types.
   - Update baseline migration to create the bottom scope row, create the trigger function / trigger that maintains closure edges to bottom, and seed any required initial closure rows in the right order.
   - Make owned scope-id columns/contracts non-nullable again where the sentinel replaces nullable bottom semantics.

2. **RBAC repository/service cutover**
   - Update assignment and capability-evaluation code to stop using `null` as bottom sentinel.
   - Update list-grant queries to return the sentinel id for explicit bottom grants.
   - Remove application-level bottom-edge maintenance that the trigger now owns.
   - Update any tests or helper expectations using `scopeId: null` / `targetScopeIds: [null]`.

3. **Document metadata cutover**
   - Migrate `documents.auth_scope_id` away from `null` in this task.
   - Update create/list/update/set-scope behavior to use explicit non-null scope ids under the sentinel model.

4. **Document list-path rewrite**
   - Remove the `resourceScope === "document"` branch from `DocumentService.list()`.
   - Always source direct granted scopes for protected lists.
   - Replace `grantedDocumentFilterScopeIds` with repository/query translation from grant rows + `resourceScope`.

5. **Tests and verification**
   - Update auth RBAC coverage for sentinel bottom grants and checks.
   - Add assertions for trigger-maintained closure behavior to bottom when scopes are created.
   - Add/adjust document metadata assertions under the new non-null scope-id model.
   - Run `bunx vitest run test/unit/server/auth-rbac.test.ts`
   - Run `bun run typecheck`

## Review gates

- Do not ship a hybrid where some RBAC/document paths still mean bottom by `null` while others use the sentinel.
- Keep tenant scoping explicit in every bottom-scope query path and trigger body.
- Bottom is part of the real scope hierarchy; do not reintroduce special-case bypass semantics around it.
- Do not duplicate trigger-owned bottom-edge logic in repository code.

## Rollback point

If the full non-nullable document metadata cutover proves larger than expected, stop and explicitly rescope rather than leaving mixed nullable/non-nullable scope semantics in the codebase.
