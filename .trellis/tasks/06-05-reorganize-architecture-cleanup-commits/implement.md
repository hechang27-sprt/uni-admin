# Implementation Plan — Reorganize architecture cleanup commits

## Goal

Recreate `xnz..ktv` as a duplicated, reviewable stack after `wwz`, while preserving exact source content outside `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**` and preserving the active task directory separately.

## Ordered Checklist

1. Establish hash guards
   - Compute the active task directory to exclude from source-equivalence hashing: `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`.
   - Record the baseline hash for the current task directory at the working copy.
   - Record source hashes for `ktv` and for each source checkpoint with the active task directory excluded.

2. Duplicate the source chain onto `wwz`
   - Duplicate `xnz` after `wwz`.
   - Duplicate each next source revision after `@-` so the new stack grows linearly beneath the empty working-copy commit.
   - After each duplication:
     - check for conflicts in `wwz::@`
     - verify normalized hash equality with the source revision just duplicated
     - verify the active task-directory hash is unchanged

3. Stabilize the duplicated chain
   - Ensure the top duplicated revision corresponds to `ktv`.
   - Confirm the duplicated tip matches `ktv` on all paths outside the active task directory.
   - If any step introduced conflicts, resolve them before further refinement.

4. Refine commit boundaries on the duplicated branch
   - Rename duplicated checkpoint commits to descriptive titles.
   - Split only the duplicated commits that are still too broad.
   - Prefer isolating bookkeeping, tooling, refactor, and semantic-fix concerns when the split can be made without breaking the hash invariant.
   - Re-run hash guards after every split, rebase, or squash.

5. Final verification
   - Inspect `jj log -r 'wwz::@'`
   - Inspect `jj log -r 'wwz::@' --summary`
   - Compare `<duplicated-tip>` against `ktv`
   - Confirm only the expected current-task files differ from `ktv`


## Current refinement status

- Split `xzvuywmk` into `docs(auth): capture omnibus auth-access checks` and `refactor: centralize auth access validation`.
- Split `nlxqorxu` into `chore(server): add DI dependencies and ignore coverage output`, `refactor(auth): prepare DI-friendly auth service`, and `refactor(documents): prepare DI-friendly document service`.
- Split `sumovrzx` into `docs(server): document auth, document, and db module split`, `refactor(server): extract db, di, and utility modules`, and `refactor(server): separate auth and documents modules`.
- Split `svsxywts` into `docs: sync agent context for capability grants` and `refactor(auth): add capability grant typing`.
- Split `nvnvxpmu` into `chore(task): capture 06-03 capability-eval batching` and `refactor(auth): batch capability evaluation`.
- Split `wrmootnl` into `docs(auth): record resourceScope none handling` and `fix(auth): treat resourceScope none consistently`.
- Split `umxqrtwm` into `chore(task): capture 06-04 scope-root document auth filtering` and `fix(documents): filter reads by granted scope roots`.
- Split `qlvmmszn` into `refactor(documents): simplify scope-root filtering queries` and `test(documents): cover scope-root filtering end to end`.
- Kept the parity model unchanged: `ktv` still remains untouched, and source-equivalence continues to exclude only `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`.

The stable task-directory guard now excludes `research/final-verification.json` itself. Including the verification report in the hash made the value self-referential and unstable every time the report was refreshed.
## Validation Commands

- `jj log -r 'wwz::@'`
- `jj log -r 'wwz::@' --summary`
- `jj log -r 'conflicts() & wwz::@'`
- `jj diff --from ktv --to <duplicated-tip> --summary`
- Hash helper over:
  - all files except `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`
  - only `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`

## Review Gates

Before mutating history:
- Confirm the source revision order and the `wwz`-only path set.
- Confirm the working copy is still the empty change above `wwz`.

Before any split/rename cleanup:
- Confirm the duplicate stack already reproduces the source content.
- Confirm conflicts are resolved so later cleanup is about reviewability, not repair.

Before handoff:
- Confirm no commit before `wwz` changed.
- Confirm normalized hash equality at the duplicated tip.
- Confirm every duplicated checkpoint commit has a readable description or was intentionally kept because it is already specific enough.

## Rollback Points

- After every duplicate: `jj undo` immediately on hash mismatch.
- After every split/rebase/squash cleanup step: re-run both hash guards before continuing.
- If a refinement step makes the branch harder to reason about, revert that step and keep the simpler duplicated version.
