# Implementation Plan

## Checklist

1. Load server coding specs with `trellis-before-dev`.
2. Run GitNexus impact analysis on symbols before edits:
   - `AuthRbacService`
   - `KyselyAuthRbacRepository`
   - `DocumentAuthorizer` if the interface changes
   - `DocumentService` if document authorization helpers change
3. Finalize service/repository types:
   - move omnibus result/failure types to `server/auth/types.ts` if public
   - keep repository-only helper result types in `repository.ts` if private
4. Refactor `server/auth/repository.ts`:
   - remove service-policy omnibus implementation from repository
   - expose focused helper methods for membership, tenant access validity,
     permission-key validity, and capability checks
   - preserve repository mutation safety where direct calls still need it
5. Refactor `server/auth/service.ts`:
   - implement omnibus `checkAccessMany`
   - update `checkAccess`, `assertAccess`, `assertAdminAccess`,
     `grantPermissionAsActor`, and `assignRoleAsActor`
   - map failures to existing `AuthRbacError` codes
6. Refactor document authorization flow if needed:
   - update `DocumentAuthorizer` contract in `server/auth/types.ts`
   - update `DocumentService` helpers to call the omnibus check and preserve
     read-null / mutation-throw semantics
7. Update tests:
   - auth/RBAC tests for owner/admin/delegated assignment checks
   - document protected batch tests for one authorizer call per operation
   - repository spies renamed from omnibus method to new helper names
8. Update specs:
   - `server/auth-rbac.md`
   - `server/document-service.md` if document authorizer contract changes
   - `server/repository-and-database.md` if helper/query conventions change

## Validation

- `npm run typecheck`
- Targeted auth/document tests:
  - `npm run test -- test/unit/server/auth-rbac.test.ts`
  - `npm run test -- test/unit/server/service.test.ts`
- `git diff --check`
- `gitnexus_detect_changes(scope: "all")`

## Risk Points

- Document service currently expects `boolean[]` from `DocumentAuthorizer`.
  Changing that contract requires careful positional mapping.
- Delegated role assignment currently uses `findDeniedRolePermission` to avoid
  per-permission loops. Preserve set-shaped SQL behavior.
- Existing dirty worktree includes unrelated edits; avoid reverting user work.

## Review Gate

Start implementation only after the user approves this plan, then run:

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/05-29-omnibus-auth-access-checks
```
