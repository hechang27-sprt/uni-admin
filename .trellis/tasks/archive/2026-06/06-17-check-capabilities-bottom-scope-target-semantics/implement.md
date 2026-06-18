# Implementation Plan: Refine `checkCapabilities` target semantics for bottom-scope RBAC

## Goal

Apply the settled boring-evaluator cutover:

- concrete scope ids, including tenant root id, stay concrete targets
- `null` target means bottom scope only
- `checkCapabilities` stops interpreting `resourceScope` or `targetMode`
- document/collection services translate auth intent before repository evaluation
- current persisted document `authScopeId = null` runtime meaning stays unchanged for this task

## Ordered checklist

1. **Type and evaluator contract cutover**
   - remove `CapabilityTargetMode`
   - remove `CapabilityAccessCheck.targetMode`
   - tighten `CapabilityAccessCheck.targetScopeIds` semantics to DB-aligned `Array<string | null>` where `null` means bottom
   - migrate `CapabilityEvaluation.missingCaps` and `AccessCheckFailure` away from `isRootScope`

2. **Repository evaluator rewrite**
   - update `KyselyAuthRbacRepository.checkCapabilities()` to:
     - stop normalizing `targetScopeIds: [null]` into tenant root
     - stop synthesizing bottom rows from `targetMode`
     - evaluate only explicit translated targets
     - keep concrete grants matching concrete descendants
     - allow both concrete grants and bottom grants to satisfy bottom targets
     - forbid bottom grants from satisfying concrete/root targets
   - keep `selectGrantedPermissions()` as the two-lane source of truth
   - migrate `listGrantedScopeIdsForCapability()` so returned `null` means bottom grant, not tenant root

3. **Service/document translation cutover**
   - update `AuthRbacService.evaluateAccess()` validation and denial mapping to match the new target contract
   - translate tenant-root checks to the actual tenant root scope id before repository evaluation
   - centralize document-service auth target translation so `document`, `tenant-root`, and `none` map to evaluator-ready targets in one place
   - preserve current document `authScopeId = null` meaning as tenant-root during that translation
   - update `listCreatableScopes()` and granted-scope/filter helpers to remove the old tenant-root-null convention

4. **Tests and spec alignment**
   - update `test/unit/server/auth-rbac.test.ts` to cover:
     - tenant-root checks using real root scope ids
     - bottom-target checks using `null`
     - bottom grants satisfying bottom checks only
     - `listCreatableScopes()` and document auth preserving current document-null behavior
   - update `.trellis/spec/server/auth-rbac.md` and `.trellis/spec/server/repository-and-database.md` to remove the old `targetMode` / root-null evaluator contract and document the new translation boundary

## Validation commands

Run only the directly affected checks after the implementation slices land:

```bash
bun test test/unit/server/auth-rbac.test.ts
bun run typecheck
bun run lint
```

## Review gates

- Before merge from sub-agents: confirm no callsite still emits `targetMode`
- Before verification: confirm no evaluator branch still treats `targetScopeIds: [null]` as tenant root
- Before final report: confirm document `authScopeId = null` behavior remains current and only higher-layer translation changed

## Rollback points

- If repository evaluation regresses, revert to the last passing contract before touching document-service translation
- If document-service translation introduces ambiguity, keep the repository boring and fix only the translator/helper layer; do not reintroduce evaluator-side mode flags
