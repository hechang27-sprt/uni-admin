# Review catalog identity and session readiness implementation plan

## Review Gate

Start this task only after PRD/design/plan exist. This plan intentionally performs review first, then targeted fixes, then verification.

## Ordered Checklist

1. Load required specs and task artifacts.
   - [ ] Server spec index plus relevant server specs.
   - [ ] Catalog migration PRD/design/implement/post-report.
   - [ ] Archived session PRD/design/implement and prior pre-feature review.

2. Run parallel review slices.
   - [ ] Catalog migration acceptance validation.
   - [ ] Auth/RBAC permission identity validation.
   - [ ] Session readiness validation.
   - [ ] Test/docs/spec consistency validation.

3. Triage findings.
   - [ ] Verify each high/medium finding against source.
   - [ ] Decide fix-now vs follow-up using design policy.
   - [ ] Run GitNexus impact before editing modified symbols.

4. Apply targeted fixes.
   - [ ] Add or update tests for bug fixes.
   - [ ] Update docs/specs only after behavior is proven.

5. Verify.
   - [ ] Run targeted tests for touched surfaces.
   - [ ] Run typecheck/lint if source changed.
   - [ ] Run GitNexus `detect_changes(scope: "all", repo: "uni-admin")`.

6. Report.
   - [ ] Summarize catalog migration verdict.
   - [ ] Summarize session readiness verdict.
   - [ ] List fixed issues, tests, residual risks, and recommended next task.

## Validation Commands

Start narrow and expand based on touched files:

```bash
bun test test/unit/server/util-db.test.ts test/unit/server/service.test.ts test/unit/server/auth-rbac.test.ts
bun run typecheck
bun run lint
```

If route/session files are added in a future task, add Nuxt route tests then; not in this review task.

## Rollback Points

- Before source edits: report-only review can be retained without code change.
- After local fixes: revert individual fixes that fail targeted behavior checks; do not compensate with compatibility shims.
