# Batch-Only Database Primitives Implementation Plan

## Scope

Refactor repeated and bulk-capable document and auth/RBAC persistence paths to
be collection-shaped and set-based where PostgreSQL can express current
semantics. Retain documented singular auth primitives where batching would not
remove repeated database work. Preserve public service behavior and document
the convention.

## Checklist

1. Load server specs and shared cross-layer/code-reuse guides before editing.
2. Run GitNexus impact analysis for every repository/service/schema symbol
   that will be changed; warn before proceeding if risk is high or critical.
3. Define batch-shaped document repository contracts and update the Drizzle
   implementation:
   - replace scalar insert/find/update/hard-delete methods;
   - retain list and remote projection collection operations;
   - preserve ordering and conflict semantics.
4. Replace per-scope document validation with a set operation and evaluate
   tenant-scoped composite foreign keys plus migration changes.
5. Update `DocumentService` and its helpers:
   - scalar service methods wrap/unwrap one-element batch calls;
   - batch methods authorize unique target scopes once;
   - mutation helpers reuse loaded documents and remove redundant reads.
6. Define batch-shaped auth authorizer/repository contracts for repeated
   workflows and update
   `DrizzleAuthRbacRepository`:
   - bulk role-permission grants;
   - role assignment operations where multi-assignment use is reasonable;
   - batch access checks and document scope lookup.
   - retain and document justified singular login, membership resolution,
     tenant-root initialization, scope-tree creation, and role lookup methods.
7. Update `AuthRbacService`:
   - scalar service APIs wrap/unwrap batch repository operations;
   - owner bootstrap uses bulk grants;
   - delegated assignment uses set-based privilege checks;
   - eliminate per-capability repository loops.
8. Update migrations/schema as justified by the final constraint design.
9. Add pgLite-backed tests for:
   - protected batch create/read/update allow and deny cases;
   - cross-tenant batched document scope validation;
   - owner bootstrap and bulk role grants;
   - delegated role assignment with multiple permissions;
   - preserved version/order/remote-side-effect behavior.
10. Update `.trellis/spec/server/repository-and-database.md`,
    `.trellis/spec/server/document-service.md`,
    `.trellis/spec/server/auth-rbac.md`, and
    `.trellis/spec/server/testing.md` with the executable batch-only
    contract.
11. Update maintainer docs only if public/current developer behavior needs
    clarification beyond the specs.
12. Run `bun run typecheck`, `bun run test`, and `bun run build`.
13. Run GitNexus change detection before committing.

## Validation Commands

```bash
bun run typecheck
bun run test
bun run build
```

## Risk Points

- Preserving scalar service errors while internal repository return shapes
  become array-based.
- Maintaining input ordering and all-or-nothing optimistic batch update
  behavior.
- Avoiding authorization regressions while combining distinct target-scope
  checks.
- Composite foreign key migration behavior under pgLite and PostgreSQL.
- Avoiding accidental remote calls before authorization.

## Review Gate

Implementation starts only after the user approves this revised plan.
