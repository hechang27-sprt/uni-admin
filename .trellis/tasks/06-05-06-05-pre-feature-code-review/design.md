# Pre-feature code review design

## Review Goal

Establish whether the current codebase is a stable foundation for restarting the auth-session endpoint design, with emphasis on code already expected to support that milestone: auth/RBAC domain logic, database/schema contracts, DI/runtime boundaries, and any existing route/frontend surface.

## Review Boundaries

### In scope

- `server/auth/*`
- `server/db/*`
- `server/di/*`
- relevant shared utilities under `server/utils/*`
- existing frontend/runtime/config files that constrain the next auth-session milestone (`nuxt.config.ts`, `package.json`, current `app/` shell if relevant)
- archived brainstorming artifacts at `.trellis/tasks/archive/2026-05/05-authentication-session-endpoints-brainstorm/` [sic: actual directory includes the date prefix in filesystem listing]

### Out of scope

- Implementing fixes during this review unless a trivially necessary correction emerges and is explicitly folded into this task later.
- Re-planning the full auth-session milestone. This review only prepares the ground for that later design reactivation.

## Review Method

1. Read current specs and archived task artifacts to establish the intended architecture and existing assumptions.
2. Inspect current source by subsystem, starting with auth/RBAC and its repository/service contracts, then DB schema/migrations/DI/runtime surfaces, then frontend/config surfaces that the planned session endpoints would touch.
3. Run repo diagnostics and targeted tests to distinguish proven breakage from design smells or latent risks.
4. Compare findings against the archived auth-session design to identify stale assumptions, missing prerequisites, or new simplifications.
5. Produce a prioritized report grouped by impact on restarting feature design.

## Finding Categories

### Blocker

Observed issue or missing boundary that should be resolved before resuming feature design because it undermines correctness assumptions, runtime viability, or the basic route/session architecture.

### Correctness risk

No failing proof yet, but current code shape makes future auth-session work likely to introduce bugs or rely on brittle behavior.

### Design / maintainability smell

Redundant logic, leaky ownership, or awkward contracts that will slow or complicate the next milestone even if they do not immediately fail.

## Evidence Standard

Each finding should cite:

- exact file(s) and symbol(s)
- observed behavior or code shape
- why it matters for the archived auth-session milestone
- whether it is proven by diagnostics/tests, directly observed from code, or an explicitly marked inference

## Verification Plan

- Use LSP diagnostics for workspace-level type/runtime surface issues where available.
- Run targeted tests for the auth/RBAC and DB layers, plus any other specific checks needed to validate a suspected issue.
- Avoid broad project-wide gates unless the changed/inspected area requires them for confidence.
