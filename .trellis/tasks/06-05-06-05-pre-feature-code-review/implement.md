# Pre-feature code review implementation plan

## Step 1 — Load context

- Read the archived auth-session brainstorm task (`prd.md`, `design.md`, `implement.md`) for the last agreed direction.
- Read applicable server/frontend specs and shared thinking guides.
- Record any assumptions that already look stale before source inspection begins.

## Step 2 — Inspect current code by dependency order

1. Runtime/config surface: `package.json`, `nuxt.config.ts`, current `app/` shell.
2. Database/schema/migration surface: `server/db/*`.
3. Auth/RBAC contracts and behavior: `server/auth/types.ts`, `errors.ts`, `repository.ts`, `service.ts`, `index.ts`.
4. DI and shared utilities used by auth/database layers.
5. Existing tests covering auth/RBAC and DB assumptions.

For each subsystem:

- note correctness issues
- note duplicated or awkward logic
- note mismatches with spec contracts or archived design assumptions
- note anything the next session-endpoint milestone would need that is currently absent or misleading

## Step 3 — Validate suspicions

- Run LSP diagnostics on the relevant TypeScript files / workspace.
- Run targeted tests or other narrow commands that prove or falsify suspected issues.
- Do not overstate findings that lack verification; label them as direct code observations or inference.

## Step 4 — Synthesize for feature reactivation

Deliver a report with:

- readiness verdict (`resume now`, `resume with caution`, or `cleanup first`)
- prioritized findings with severity and evidence
- stale assumptions in the archived auth-session task
- recommended cleanup order before or during renewed feature design

## Review gates before closing

- Findings are grounded in exact file/symbol references.
- At least one automated validation source is cited when it materially strengthens a finding.
- Report explains why each issue matters specifically for the auth-session endpoint milestone, not only in general.
