# Design — Reorganize architecture cleanup commits

## Problem

The original architecture-cleanup work lives in the source range `xnz..ktv`. The earlier plan tried to move changes out of those commits into new grouping commits, but that approach created conflicts and made it too easy to perturb repository content.

The safer model is now:

- keep the original source stack intact
- create a brand-new duplicated stack after `wwz`
- verify, after every mutation, that the duplicated branch still matches the source content on all paths outside the active task directory `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`

## Goals

- Leave the original `xnz..ktv` history untouched.
- Build a new stack after `wwz` that is safe to inspect, edit, and later clean up.
- Preserve exact source content while preserving the current task directory on the working branch.
- Improve reviewability by renaming checkpoint commits and splitting only the duplicated commits that are still too mixed.

## Non-Goals

- Do not rewrite or empty the original source commits.
- Do not drop content from the duplicated tip merely because it looks like bookkeeping; if it is part of `ktv`, it stays unless the user explicitly says otherwise.
- Do not modify any tree state before `wwz`.

## Invariants

### 1. Source branch invariant

All work happens on descendants of `wwz`. The original `xnz..ktv` revisions remain available as the authoritative source of truth.

### 2. Normalized tree invariant

- hash(`@`, excluding `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`) must equal hash(`<source-rev>`, excluding the same directory)
- hash(`@`, including only `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`) must equal the working-copy baseline for that directory

This catches both accidental source drift and accidental edits to the active task artifacts while the duplicate stack is being built.

### 3. Conflict locality invariant

If duplication or later commit-splitting introduces a conflict, resolve it only in the duplicated branch. The source revisions must never be edited to make the duplicate easier.

## Rewrite Strategy

### Phase A — Recreate the source stack safely

Duplicate the source commits in topological order onto the branch after `wwz`.

Recommended command pattern:

- first source commit: `jj duplicate xnz --after wwz`
- later source commits: `jj duplicate <source> --after @-`

Because `@` stays as the empty working-copy change at the top, `@-` tracks the most recently duplicated commit. This yields a linear duplicate stack while leaving the source branch untouched.

After each duplicate:

1. inspect `jj log -r 'wwz::@'`
2. compute normalized hashes
3. check `jj log -r 'conflicts() & wwz::@'`
4. stop immediately on mismatch

### Phase B — Improve duplicated commit boundaries

Once the duplicate stack exists and matches the source tip, refine only the duplicated commits.

Preferred order:

1. rename duplicated `WIP` commits to descriptive messages
2. inspect mixed commits (`uqlwpsuk`, `kxmnywsn`, `ktmzsmov`, `sptnknvq`, `wsworlsu`, `ssuqwkky`) on the duplicate branch
3. split only where the review unit is still too broad
4. re-run normalized hashes after every split/rebase/squash step

This is safer than trying to pre-group the source branch by squashing from old commits into new ones.

## Expected Fine-Grained Shape

The new stack will likely still contain several small bookkeeping commits because those changes are part of the source tip and must be preserved. The fine-grained improvement comes from:

- keeping tiny bookkeeping changes isolated instead of mixing them with code
- renaming checkpoint commits to explain their real concern
- splitting only the large mixed refactor/fix checkpoints on the duplicated branch

A likely end state is more than the previous five groups, not fewer.

## Risks

- Duplicating onto a branch that already carries active task artifacts can create misleading hash failures unless the task directory is excluded from source-equivalence checks and guarded separately.
- Some mixed checkpoints may require hunk-level duplication or split operations to avoid dragging unrelated task/spec churn into a code-focused commit.
- Archive/journal commits are noisy but still part of the source tip; dropping them would violate the normalized tree invariant.

## Verification Model

Primary verification is content equivalence, not tests:

- normalized SHA-256 hashes after every history mutation
- `jj diff --from ktv --to <duplicated-tip> --summary` at the end
- `jj log -r 'wwz::@' --summary` to ensure messages and boundaries are reviewable

Run code tests only if conflict resolution or splitting requires real content edits beyond history motion.
