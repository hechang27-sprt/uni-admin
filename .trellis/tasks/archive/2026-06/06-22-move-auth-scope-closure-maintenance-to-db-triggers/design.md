# Design: move `auth_scope_closure` maintenance to DB triggers

## Problem

`auth_scope_closure` is currently maintained in two places:

- database trigger `maintain_bottom_scope_closure()` inserts only the concrete-scope-to-bottom row
- repository methods `ensureTenantRootScope()` and `createScope()` insert self and ancestor closure rows directly

That split makes `auth_scope_closure` a partially derived table with duplicated write logic. The user wants the same ownership model as the existing bottom-scope trigger: application code should mutate `auth_scopes`, and the database should derive closure rows.

## Decision

Promote the `auth_scopes` insert trigger from a bottom-row helper into the single closure-maintenance mechanism for scope creation.

On every inserted `auth_scopes` row except the physical bottom scope row, the trigger will:

1. insert the new scope self row `(scope_id, scope_id, 0)`
2. insert ancestor-to-new-scope rows by reading the parent scope's existing closure rows
3. insert the concrete-scope-to-bottom row `(scope_id, BOTTOM_SCOPE_ID, 1)`

The repository will only insert into `authScopes`; it will stop touching `authScopeClosure` entirely.

## Why this shape

- Preserves the current scope-creation API surface.
- Keeps hierarchy derivation next to the source-of-truth table.
- Reuses FK cascades for deletion; no application cleanup path is needed.
- Avoids round-tripping ancestor rows through TypeScript.
- Matches the project rule in `auth-rbac.md`: child auth-scope creation should derive closure rows in SQL, not in mapped TS follow-up inserts.

## Data-flow / invariants

### Inserting tenant root

`ensureTenantRootScope()` inserts a root row in `auth_scopes` with `parent_id = null`.

Trigger result:
- self row: `(root, root, 0)`
- bottom row: `(root, bottom, 1)`
- no parent-derived ancestor rows because `parent_id is null`

### Inserting child scope

`createScope()` inserts a child row in `auth_scopes` with `parent_id = <parent>`.

Trigger result:
- self row: `(child, child, 0)`
- ancestor rows from every existing closure row ending at the parent, with `depth + 1`
- bottom row: `(child, bottom, 1)`

Because the parent already has all ancestor rows, this preserves transitive closure in one SQL operation.

## Trigger contract

- Trigger remains `AFTER INSERT ON auth_scopes`.
- Bottom physical row short-circuits exactly as today.
- Inserts use `on conflict do nothing` so repeated root bootstrap stays idempotent.
- Parent-derived insert filters by `tenant_id = new.tenant_id` and `descendant_id = new.parent_id` to preserve tenant isolation.

## Repository cutover

### `ensureTenantRootScope()`

Keep:
- idempotent insert into `authScopes`
- fallback read when `onConflict(...doNothing())` returns no row

Remove:
- direct inserts into `authScopeClosure`

### `createScope()`

Keep:
- parent existence check scoped by tenant
- insert into `authScopes` via CTE expression
- `AUTH_SCOPE_NOT_FOUND` when parent missing

Remove:
- closure CTE that inserts into `authScopeClosure`

Because closure is now DB-owned, the repository only needs the inserted scope row.

## Blast radius

Required GitNexus impact checks on the implementation methods were attempted, but the MCP rejected normal callgraph requests whenever the `line` field was present and also rejected pdg defaults with `crossDepth`; this was reported via `report_tool_issue`.

Observed call surface from source inspection:
- `AuthRbacService.ensureTenantRootScope()` and `AuthRbacService.getTenantRootScopeId()` delegate to repository root creation.
- `AuthRbacService.createScope()` and `createScopeAsActor()` delegate to repository scope creation.
- RBAC capability checks and document filtering read `auth_scope_closure` indirectly through existing query helpers, so migration correctness is the primary risk.

Risk assessment: MEDIUM. Scope creation is a narrow write surface, but many auth/document flows depend on closure correctness.

## Verification strategy

- Extend pgLite auth-RBAC tests to assert root + child closure rows still appear after repository cutover.
- Run the focused auth-RBAC suite because it exercises scope creation, bottom-target permissions, and direct closure assertions.
- If needed, run the document service suite only if auth-RBAC coverage proves insufficient.
