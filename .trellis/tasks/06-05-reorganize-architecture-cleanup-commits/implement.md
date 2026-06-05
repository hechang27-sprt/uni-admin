# Implementation Plan — Reorganize architecture cleanup commits

## Goal

Replace the checkpoint-heavy jj history from `xnz` through `ssu` with a reviewable stack whose commit boundaries match the actual architectural, tooling, and behavior-change concerns.

## Ordered Checklist

1. Confirm planning baseline
   - Keep `xnz` as the fixed lower bound and `ssu` as the content tip to preserve.
   - Treat the current empty working change above `ssu` as scratch space only.
   - Use the planning default unless user requests otherwise: drop journal-only and archive-only churn.

2. Map current mixed commits onto target groups
   - Identify which existing changes contribute primarily to:
     - tooling / Trellis / OMP bootstrap
     - server boundary refactor
     - utility/query extraction
     - auth semantic fixes
     - document scope-root filtering
   - Note any files that appear in multiple conceptual groups and choose the least-surprising home for them.

3. Rewrite history with jj
   - Use `jj edit`, `jj split`, `jj new`, and `jj rebase` to carve mixed checkpoint commits into the target groups.
   - Use `jj describe -m` to replace WIP messages.
   - Use `jj abandon` to remove bookkeeping-only commits from the cleaned stack.
   - Preserve descendants by restacking rather than reapplying diffs manually.

4. Normalize final stack
   - Ensure each resulting commit has one primary concern.
   - Ensure commit order is understandable from bottom to top.
   - Keep LSP/tooling changes separate if they remain independently reviewable.

5. Verify equivalence and reviewability
   - Compare rewritten tip against `ssu`.
   - Inspect `jj log` / `jj log --summary` for the rewritten range.
   - If the rewrite required content edits beyond regrouping, run the narrowest relevant tests for the touched behavior.

## Validation Commands

- `jj log -r 'xnz::<rewritten-tip>'`
- `jj log -r 'xnz::<rewritten-tip>' --summary`
- `jj diff --from ssu --to <rewritten-tip>`
- `jj diff --from xnz --to <rewritten-tip> --stat`
- Optional only if content changed during rewrite: narrow `bun run vitest --project unit ...` commands for affected tests

## Review Gates

Before `task.py start` / before execution:
- Confirm the target stack shape separates structural refactor, tooling bootstrap, and semantic fixes.
- Confirm pure bookkeeping-only commits are intentionally dropped rather than accidentally lost.
- Confirm the task is a history rewrite, not a fresh implementation task.

Before final handoff:
- Confirm rewritten tip matches `ssu` or document every intentional difference.
- Confirm no commit message is still checkpoint/WIP style.
- Confirm reviewers can understand each commit without cross-reading unrelated diffs.

## Rollback Points

- After every major split or rebase cluster, `jj log` the range before continuing.
- If a split or rebase groups files incorrectly, use `jj undo` immediately.
- If the rewrite path becomes harder than reconstructing the stack from `ssu`, stop and re-plan rather than layering more corrective rebases on top.