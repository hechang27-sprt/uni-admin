# Fix resourceScope none authorization semantics

## Goal

Resolve the design gap in collection authorization scope semantics so `CollectionResourceScopeMode` expresses distinct, defensible behavior for document-scoped checks versus tenant-root-scoped checks, with the decision grounded in both the current RBAC evaluator and planned authentication/session endpoint design.

## What I already know

- `resourceScope: "none"` currently routes through `DocumentService` by passing `targetScopeIds: [null]` into `AuthRbacService.evaluateAccess(...)`.
- In this RBAC model, `null` means tenant-root scope, not absence of a target scope.
- The current implementation therefore treats `resourceScope: "none"` as root-scoped authorization, not as a true escape hatch from target-scope checking.
- `.trellis/spec/server/auth-rbac.md` currently states: `resourceScope: "none" checks only tenant-root capability and skips document containment.`
- The user recalls the original intent differently: `resourceScope: "none"` should skip `targetScopeId` checks completely.
- `KyselyAuthRbacRepository.checkCapabilities(...)` structurally models authorization as capability evaluation against `targetScopeIds`; it laterally unnests `targetScopeIds` and does not currently support a first-class "no target scope" capability check.
- The auth model therefore currently supports document/descendant checks and tenant-root checks, but not a true unscoped capability-evaluation mode.
- The archived task `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/` plans session/auth endpoints that keep permissions fully database-backed and tenant-aware. Sessions hold user identity plus zero-or-one selected tenant; they do not cache or broaden permission state.
- That archived design expects account/session endpoints to remain outside tenant-actor resolution when no tenant is selected, and expects tenant-scoped operations to continue resolving through live membership-backed authorization.

## Requirements

- Trace the actual behavior of `resourceScope: "none"` across `DocumentService`, `AuthRbacService`, and repository capability evaluation.
- Determine whether the current spec is incorrect, the implementation is incorrect, or the enum shape is underspecified.
- Evaluate the semantics against the archived authentication/session endpoint design so the naming/design choice does not create future route-layer confusion.
- Produce a clear design decision that distinguishes document-scoped, tenant-root-scoped, and any future truly-unscoped authorization behavior.
- Limit this task to semantic cleanup only: explicit tenant-root terminology with no new unscoped evaluator mode.

## Acceptance Criteria

- [x] The current `resourceScope: "none"` behavior is traced from service callsites down to repository capability checks.
- [x] The archived authentication/session endpoint design is reviewed for how future route/session auth would interact with these semantics.
- [x] The intended semantics are documented in the task artifact with explicit options and trade-offs.
- [x] The chosen direction clearly distinguishes tenant-root-scoped behavior from any future truly-unscoped behavior.
- [x] The selected direction is semantic cleanup only: rename to explicit tenant-root terminology without introducing a new auth mode.

## Definition of Done

- Requirements and semantics are explicit enough to implement without guesswork.
- A design choice is recorded with its compatibility impact.
- Follow-up implementation artifacts can be written without re-opening the semantics question.

## Technical Approach

Current observed model:

- `document` means evaluate the capability at the document `auth_scope_id` (with `null` normalized to tenant root).
- `none` currently means evaluate the capability at tenant root.
- There is no implemented evaluator path for a capability check that omits scope targeting altogether.

Chosen direction:

### Semantic cleanup only (Selected)

- Replace `"none"` with an explicit mode such as `"tenant-root"`.
- Update specs/tests/source to describe the actual model honestly.
- Defer any true-unscoped capability mode until a concrete use case requires evaluator support.

Why selected:

- Matches current evaluator and service behavior.
- Lowest compatibility and implementation risk.
- Makes future session/route auth easier to reason about because it stops overloading `"none"`.
- The archived session-endpoint design does not currently justify adding a true-unscoped collection auth mode.

Rejected for this task:

- Add a third explicit unscoped mode now.
- Redefine `"none"` in place to mean unscoped.

## Decision (ADR-lite)

**Context**: `resourceScope: "none"` is misleading because current code and spec actually implement tenant-root capability evaluation, not absence of scope targeting.

**Decision**: Rename the mode to explicit tenant-root terminology and keep evaluator behavior unchanged.

**Consequences**: Source declarations/tests/specs require a clean-cut rename. A future truly-unscoped mode remains possible, but must be introduced explicitly as a separate auth-model change.

## Out of Scope

- Broad RBAC redesign outside collection resource-scope semantics.
- Implementing the archived authentication/session endpoint milestone itself.
- UI or route-layer changes unrelated to clarifying the authorization model.
- Introducing a new unscoped capability-evaluation path.

## Technical Notes

- Relevant files: `server/data/documents/service/service.ts`, `server/data/documents/registry.ts`, `server/auth/service.ts`, `server/auth/repository.ts`, `test/unit/server/auth-rbac.test.ts`, `.trellis/spec/server/auth-rbac.md`.
- Archived design reviewed: `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/prd.md`, `design.md`, `implement.md`.
- Key repository constraint: `checkCapabilities(...)` laterally unnests `targetScopeIds`; empty/omitted target-scope evaluation is not a supported concept today.
