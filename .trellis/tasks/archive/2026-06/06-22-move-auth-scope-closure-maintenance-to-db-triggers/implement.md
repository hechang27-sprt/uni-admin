# Implement: move `auth_scope_closure` maintenance to DB triggers

1. Update baseline migration trigger in `server/db/migrations/001-baseline.ts`
   - replace the bottom-only trigger body with full insert-time closure maintenance
   - preserve bottom-row short-circuit and idempotent inserts

2. Cut repository writes in `server/auth/um/repository.ts`
   - remove direct closure inserts from `ensureTenantRootScope()`
   - remove the closure-writing CTE from `createScope()`
   - keep existing return/error behavior unchanged

3. Add/adjust pgLite tests in `test/unit/server/auth-rbac.test.ts`
   - prove tenant root gets its self closure row via trigger
   - prove child scope gets ancestor/self/bottom closure rows via trigger

4. Verification
   - run the focused auth-RBAC Vitest file
   - if failure points at broader document behavior, run the relevant document suite as a follow-up

## Review gate before `task.py start`

- Planning artifacts reflect DB-owned closure maintenance only.
- No scope-semantics expansion beyond creation-time closure derivation.
- Verification is focused on affected auth-RBAC behavior.
