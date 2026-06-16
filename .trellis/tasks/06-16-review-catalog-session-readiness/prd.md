# Review catalog identity and session readiness

## Goal

Perform a second code review of the current codebase to validate the completed `app-catalog-identity-migration` Trellis task, refresh readiness for implementing `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/`, and eliminate any concrete bugs/design smells/tech debt found during review.

## Requirements

- Validate `app-catalog-identity-migration` against its `prd.md`, `design.md`, and `implement.md` acceptance criteria.
- Compare the archived authentication/session endpoint plan against the current Kysely/catalog/auth code after the catalog migration.
- Review current server code for concrete bugs, design smells, duplicated identity logic, stale docs/specs, and session-readiness gaps.
- Fix confirmed issues at source when safe within this review task.
- Do not introduce session endpoints in this task; only prepare and unblock that implementation.
- Preserve current public behavior unless a confirmed bug requires correction.

## Acceptance Criteria

- [ ] Review covers catalog/schema/repository/service/auth/RBAC/session-prep surfaces with exact file/symbol evidence.
- [ ] `app-catalog-identity-migration` is classified as valid, invalid, or valid-with-followups, with concrete evidence for each acceptance criterion.
- [ ] Session endpoint plan has an updated readiness assessment: stale assumptions, prerequisites, and code changes needed before implementation.
- [ ] Confirmed bugs/design smells/tech debt are fixed or explicitly recorded as follow-up if they require a separate feature task.
- [ ] Targeted tests/typecheck/lint relevant to touched files pass.
- [ ] GitNexus `detect_changes(scope: "all")` is run before final report.

## Definition of Done

- Review findings and fixes are grounded in source, specs, and targeted checks.
- No compatibility shims or stale aliases are added.
- Specs/docs are updated only when a discovered durable convention or changed behavior requires it.
- Final output lists changed files, verification, residual risks, and whether session endpoint implementation can proceed.

## Out of Scope

- Implementing actual session persistence or API routes.
- Adding protected document CRUD routes or frontend auth UI.
- Broad refactors not tied to a confirmed bug/design smell.
- Changing product scope from the archived session PRD.

## Technical Notes

- Catalog task: `.trellis/tasks/06-08-app-catalog-identity-migration/`.
- Session task: `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/`.
- Prior review: `.trellis/tasks/archive/2026-06/06-05-06-05-pre-feature-code-review/report.md`.
- Current specs confirm Kysely, app/catalog identity, canonical permission keys, and reserved `server/auth/session/` for future session work.
