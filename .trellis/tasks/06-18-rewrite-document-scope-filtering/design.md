# Design — Rewrite document scope filtering with a physical bottom scope

## Problem

The current plan still overloads `null` in authorization contracts:

- explicit bottom grants are stored as `user_role_assignments.scope_id = null`
- bottom checks are expressed as `targetScopeIds: [null]`
- document metadata also uses `documents.auth_scope_id = null` for a separate tenant-root convention

That makes the proposed repository-owned list-filter translation fragile. The user chose a cleaner model: stop juggling nulls and use a physical bottom-scope sentinel id `00000000-0000-0000-0000-000000000000`, backed by real rows in the scope and closure tables, with a full cutover that also migrates document metadata away from `null`.

## Decision

Adopt a physical bottom scope for RBAC and document metadata and make it part of the closure model:

- add a concrete bottom-scope row with id `00000000-0000-0000-0000-000000000000`
- use the same all-zero UUID as the canonical global/system tenant id that owns that row in `auth_scopes.tenant_id`
- add closure rows so the bottom scope is a descendant of every concrete scope
- use a database trigger to maintain the bottom-scope closure invariant instead of reimplementing it in each code path
- update RBAC repository/service code to stop using `null` as the bottom assignment/target sentinel
- migrate `documents.auth_scope_id` away from `null` too, so document metadata participates in the same sentinel model
- make scope ids non-nullable again in DB contracts and code paths owned by this cutover
- represent tenant-root everywhere with the actual tenant root UUID, never an alias
- then simplify `DocumentService.list()` to always feed direct grant rows into repository list translation

Bottom is no longer a special bypass path. It becomes an actual scope in the hierarchy, represented physically and handled through ordinary non-null scope ids.

## Settled points

These are now decided and do not need more discussion:

- tenant-root ids are always real UUIDs in inputs, outputs, and persisted document metadata
- omitted/default document scope should normalize to the real tenant root UUID, not to `null`
- bottom is represented only by the sentinel scope id
- code paths owned by this cutover should not expose nullable scope ids anymore
- the canonical system/global tenant id also uses the all-zero UUID, and the global bottom-scope row in `auth_scopes` belongs to that tenant id

## Scope of change

### RBAC schema/model

Current model:
- `authScopes` contains only tenant-created scopes
- `authScopeClosure` contains ordinary ancestor/descendant closure
- `user_role_assignments.scope_id = null` means bottom

New model:
- `authScopes` contains a physical bottom scope row at the all-zero UUID
- that bottom scope row belongs to the canonical global/system tenant id, also the all-zero UUID
- `authScopeClosure` contains self-row for bottom and ancestor→bottom rows for every concrete scope in the tenant
- `user_role_assignments.scope_id` points at the sentinel bottom scope id instead of null for explicit bottom grants
- scope-id contracts become non-nullable again in the owned DB/code paths

This removes the need for null-aware role-assignment uniqueness and makes bottom a normal closure target.

### Trigger-owned closure invariant

Instead of teaching every repository method to remember the bottom edge, enforce the invariant in the database:

- when a scope row is inserted, a trigger inserts the required closure row(s) linking that scope to bottom
- the trigger owns the rule that bottom is a descendant of every concrete scope
- application code can keep creating scopes through ordinary inserts/CTEs without a parallel bottom-maintenance branch

Benefits:
- one enforcement point
- no drift between `ensureTenantRootScope()`, `createScope()`, future bulk seed paths, or ad-hoc SQL
- bottom semantics become part of database truth, not a repository convention

Constraints:
- the bottom scope row itself must exist before the trigger can add descendant rows to it
- baseline migration must create the trigger/function and seed the sentinel row in a safe order
- trigger logic must remain tenant-scoped so a global sentinel id cannot leak closure edges across tenants

### Scope creation

`ensureTenantRootScope()` and `createScope()` currently only create ordinary self/ancestor closure rows. After the trigger change they should no longer own explicit bottom-edge maintenance beyond ensuring their inserts participate in the normal scope creation flow.

Because the sentinel id is global and fixed, the safe shape is:
- one physical bottom scope row in `authScopes`
- that row uses the canonical global/system tenant id `00000000-0000-0000-0000-000000000000`
- closure rows remain tenant-scoped, so tenancy is enforced by `auth_scope_closure.tenant_id`
- trigger queries and any FK/use of the sentinel through tenant-scoped joins must still respect `tenant_id`

### Document metadata cutover

Current model:
- `documents.auth_scope_id = null` carries a special tenant-root-document convention

New model:
- `documents.auth_scope_id` also moves off `null`
- tenant-root documents use the real tenant root UUID
- bottom documents use the sentinel UUID
- service and repository code can no longer rely on a document-null compatibility path
- document scope-id contracts become non-nullable again where this task owns them

This is the largest semantic change in the task and requires nearby tests for create/list/update/set-scope behavior.

## Document read-path design

After the sentinel cutover:
- `DocumentService.list()` resolves capability once and always calls `listGrantedScopesForCapability(...)` for protected lists.
- It passes direct grant rows plus `resourceScope` into repository list.
- Repository/query code translates those grant rows using ordinary non-null scope ids, including the sentinel bottom id when relevant.

The old `grantedDocumentFilterScopeIds` collapse helper should disappear.

## Risks

1. **Schema blast radius**
   - This is no longer a service/repository-only task. It touches baseline migration, trigger DDL, scope creation, role assignments, capability checks, list grants, document auth metadata, and tests.

2. **Tenant isolation with a global sentinel id**
   - A physical bottom row shared by all tenants can be safe only if every query path and trigger body keeps tenant-scoped joins authoritative.

3. **Trigger opacity**
   - Triggers reduce application duplication but can hide behavior from readers. Tests and migration comments must make the invariant explicit.

4. **Document metadata behavior change**
   - Because `documents.auth_scope_id` also moves off `null`, create/update/patch/set-scope/list behavior all need review.

## Verification shape

At minimum, the implementation phase must cover:
- auth RBAC suite for capability evaluation and list filtering
- schema/migration assertions around bottom scope creation, trigger behavior, and closure rows
- document metadata behavior assertions under the sentinel model
- typecheck

## Superseded plan

The prior design using `null` as bottom for this task is obsolete and should not be implemented.
