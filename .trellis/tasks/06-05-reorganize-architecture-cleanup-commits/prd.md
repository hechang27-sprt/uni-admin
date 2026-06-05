# Reorganize architecture cleanup commits

## Goal

Rewrite the jj history from `xnz` (`refactor: centralize auth access validation`) through `ssu` (`WIP: checkpoint 12`) into a small, coherent stack that reflects the intended architecture cleanup, boundary enforcement, tooling setup, and follow-up auth/document fixes.

## What I already know

- The current range spans 21 changes, most labeled `WIP: checkpoint*`.
- The final tree at `ssu` includes three broad categories of work:
  - server refactors in `server/auth/**`, `server/data/documents/**`, `server/db/**`, `server/di/**`, and `server/utils/**`
  - tooling / workflow setup in `.omp/**`, `.trellis/**`, `.omp/lsp.json`, `package.json`, `bun.lock`, `nuxt.config.ts`
  - behavior fixes and test updates around auth/resource-scope handling and document read filtering
- Pure bookkeeping changes are mixed into the same range: journal updates and archived task-directory moves.
- The working copy is currently clean and sits on a new empty change above `ssu`.

## Requirements

- Preserve the intended end-state content represented by `ssu`, except for pure bookkeeping changes that are intentionally dropped from the rewritten public stack.
- Replace checkpoint-style history with commit groups that each have one clear concern and a durable commit message.
- Separate unrelated concerns instead of mixing them inside the same commit:
  - architecture / module-boundary refactors
  - shared utility extraction / query helpers
  - tooling / Trellis / local OMP setup
  - auth and document behavior fixes with their tests
- Keep the rewritten stack reviewable: each commit should have a readable diff and an explanation that matches the files it changes.
- Avoid introducing new code changes beyond what is already present at `ssu`, unless required to make the regrouped commits internally consistent.

## Acceptance Criteria

- [ ] `jj log -r 'xnz::<rewritten-tip>'` shows a coherent rewritten stack with descriptive commit messages instead of WIP checkpoints.
- [ ] `jj diff --from ssu --to <rewritten-tip>` is empty, or any intentional difference is explicitly documented before handoff.
- [ ] Pure bookkeeping-only history (journal / archive churn) is either dropped or isolated from product/tooling commits.
- [ ] Architecture, tooling, and auth/document behavior changes are grouped into separate commits with no major unrelated spillover.
- [ ] The final rewritten stack is ready for normal review without requiring reviewers to reconstruct intent from checkpoint commits.

## Open Question

- Default recommendation: drop journal-only and archive-only changes from the cleaned stack, and keep only repo-affecting tooling/task artifacts when they materially support the code changes.

## Out of Scope

- Changing behavior beyond the `ssu` tree.
- Re-designing the code again while rewriting history.
- Squashing everything into one mega-commit.

## Technical Notes

- Range inspected with `jj log -r 'xnz::ssu'`, `jj log -r 'xnz::ssu' --summary`, and `jj diff --from xnz --to ssu --stat`.
- Major touched paths include `server/auth/**`, `server/data/documents/**`, `server/db/**`, `server/di/**`, `server/utils/**`, `.omp/**`, `.trellis/**`, and unit tests under `test/unit/server/**`.
- Likely rewrite tools: `jj split`, `jj rebase`, `jj describe`, `jj abandon`, `jj new`, and `jj undo` as rollback.