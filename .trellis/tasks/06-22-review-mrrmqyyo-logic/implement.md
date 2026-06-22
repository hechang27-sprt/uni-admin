# Implementation Plan — fix mrrmqyyo protected-list regressions

## Scope

Implement the confirmed fixes from the review task:
- repair protected-list filtering for `tenant-root` and `none`
- clean up stale Auth/RBAC spec examples
- add tests that would have caught both regressions

## Ordered checklist

1. **Re-read the affected list-filter path**
   - `server/data/documents/service/service.ts`
   - `server/data/documents/repository/kysely.ts`
   - `server/data/documents/repository/query.ts`
   - `server/db/query.ts`
   - `server/auth/um/repository.ts`

2. **Decide the repository input contract for the patch**
   - Preferred: DB-derived `resourceScope` from canonical permission metadata
   - Fallback: keep current input contract but add the correct effective-descendant target logic
   - Record the chosen path in the implementation notes before editing code

3. **Fix repository list filtering**
   - `document` mode stays row-correlated
   - `tenant-root` mode must require closure reachability to the real tenant root descendant
   - `none` mode must require closure reachability to `BOTTOM_SCOPE_ID`
   - remove any remaining boolean shortcut that bypasses the descendant reachability check

4. **Update the service/query contract only as needed**
   - If using the DB-derived path, pass canonical permission identity instead of raw `resourceScope`
   - If using the bounded patch, pass the minimal effective-target data required for correct closure checks
   - Do not introduce a second compatibility helper layer

5. **Update specs in the same patch**
   - `.trellis/spec/server/auth-rbac.md`
   - remove stale nullable scope examples
   - replace the stale `auth_scope_id = null` good-case example

6. **Add/update tests**
   - `test/unit/server/auth-rbac.test.ts`
   - add a tenant-root protected-list deny case for child-only grant
   - add a none protected-list allow case for ancestor/root grant reaching bottom
   - keep existing capability-evaluation assertions that encode the intentional bottom-target semantics

7. **Run targeted verification**
   - `bun run typecheck`
   - `bunx vitest run test/unit/server/auth-rbac.test.ts`
   - add any narrower command used during development to the task notes if it proves a specific branch

## Review gates

- Gate 1: repository filter logic matches mutation authorization semantics for the same collection mode
- Gate 2: new tests fail against the buggy logic and pass after the fix
- Gate 3: spec text no longer contradicts explicit-root / explicit-bottom sentinel semantics

## Rollback notes

- If DB-derived metadata resolution expands the patch too far, revert to the bounded correctness patch and capture the canonicalization work as a separate follow-up.
- Do not weaken tests to fit the current buggy behavior.
