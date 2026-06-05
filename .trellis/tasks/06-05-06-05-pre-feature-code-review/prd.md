# Pre-feature code review before auth session redesign

## Goal

Perform a last review pass over the current codebase before reactivating work on `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm`, so the next feature-design cycle starts from a grounded picture of what is solid, what is risky, and what should be simplified first.

## Requirements

- Review the current application code with emphasis on server/auth/data-layer behavior, but include any frontend or configuration findings that materially affect the next auth-session milestone.
- Identify not only overt bugs, but also redundant logic, drift from project specs, questionable contracts, and architecture/design smells that would increase the cost or risk of the upcoming session-endpoint work.
- Cross-check the archived brainstorming/design assumptions against the current repository state so reactivation is based on present facts rather than week-old assumptions.
- Ground findings in observed code, tests, diagnostics, and repository structure. Avoid speculative findings unless they are clearly labeled as inference.
- Prioritize findings by feature-reactivation impact: blockers first, then correctness risks, then maintainability/design debt.
- Produce actionable recommendations: exact files/symbols involved, why the current shape is risky or redundant, and what kind of follow-up work is warranted before or during the next feature-design task.

## Acceptance Criteria

- [ ] Review inspects the current auth/RBAC implementation, database/schema layer, DI/runtime boundary, and any route/frontend surface relevant to future session endpoints.
- [ ] Review includes evidence from automated checks available in-repo (at minimum diagnostics and targeted tests/commands where they materially validate findings).
- [ ] Review compares the archived auth-session brainstorming artifacts with the current codebase and calls out any stale assumptions or newly relevant constraints.
- [ ] Final output is a prioritized review report with exact file/symbol references, concrete reasoning, and a recommendation on whether feature design can resume immediately or should wait for cleanup.

## Notes

- Complex review task. Keep planning artifacts (`design.md`, `implement.md`) before task activation.
- Primary archived context: `.trellis/tasks/archive/2026-05/05-25-authentication-session-endpoints-brainstorm/`.
- Primary spec inputs: `.trellis/spec/server/` and `.trellis/spec/guides/`.
