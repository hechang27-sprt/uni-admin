# Implementation Plan — Enrich ZenStack prototype schema toward full framework data model

## Ordered steps

1. **Refit schema identifiers and lifecycle fields**
   - Convert prototype ids to UUID-native columns with explicit Postgres types.
   - Add representative timestamp/version/lifecycle/remote metadata fields.
   - Keep scalar columns grouped before relations.

2. **Expand framework-owned relational surface**
   - Add catalog/enablement/auth/session/RBAC models needed for the richer prototype.
   - Preserve explicit managed vs unmanaged model boundaries.

3. **Implement closure-only effective-access policy traversal**
   - Remove `DerivedCapabilityGrantReachableScope` model.
   - Express policy read/update/create checks via `grantScope.closureAsAncestor?[descendantId == this.authScopeId]` inside existing `DerivedCapabilityGrant` filters.
   - If the nested traversal causes generation or runtime failures, document the exact error and restore the helper table. The design choice is correct; a fallback confirms the necessary data shape empirically.

4. **Update runtime seed data**
   - Replace placeholder string ids with stable UUID literals.
   - Seed richer catalog, membership, credential, session, role/permission/assignment, and document metadata.
   - Keep actor context returned through `protectedClient.$setAuth(...)`.

5. **Update focused prototype test**
   - Assert the richer metadata and relationships that matter for the redesign.
   - Preserve existing policy coverage and add create-shape/lifecycle assertions where meaningful.

6. **Validate**
   - Run schema generation.
   - Run focused test file.
   - If policy/model generation fails, iterate on schema shape before broadening assertions.

## Validation commands

```bash
bunx zen generate --schema server/zenstack/prototype-relational-redesign/prototype.zmodel --output server/zenstack/prototype-relational-redesign/generated
bunx vitest run test/unit/server/zenstack/prototype-relational-redesign.test.ts
```

## Review gates before `task.py start`

- PRD reflects the redesign-vs-source reconciliation.
- Design explicitly covers create-policy constraints and denormalization tradeoff.
- Implementation plan stays inside the prototype boundary.

## Rollback points

- If UUID-native conversion causes widespread friction, first restore generation with UUID strings only, then re-add lifecycle/RBAC breadth incrementally.
- If normalized closure-only policy fails under ZenStack, restore the reachable-scope helper table rather than weakening RBAC semantics.
- If richer RBAC tables overwhelm the focused prototype, keep representative definition tables plus a tested effective-access surface rather than forcing unused complexity into runtime assertions.
