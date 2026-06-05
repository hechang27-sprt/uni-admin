# Reorganize architecture cleanup commits

## Goal

Create a new reviewable jj stack **after `wwz`** by duplicating the changes from `xnz` through `ktv` onto descendants of `wwz`, while leaving the original `xnz..ktv` history untouched.

## What changed since the first plan

- The previous move-based regrouping was reverted because it was conflict-prone and too easy to perturb real content.
- The repo was restored to the original source stack.
- A new checkpoint commit, `wwz` (`meta: start working from here`), now sits on a sibling branch from `rtn` and contains only the current Trellis task files.
- The rewrite must now be **duplicate-only**: do not move or empty the original source commits.

## Requirements

- Modify only commits **after `wwz`**. Do not rewrite or otherwise alter any revision in the original `xnz..ktv` range.
- Duplicate the source history from `xnz` through `ktv` onto a new stack after `wwz`.
- Preserve the current task directory on the working branch:
  - `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`
- Preserve the source content exactly on every path outside that active task directory. The duplicated stack's tip must match `ktv` for all non-task paths.
- Keep the new stack **finer-grained** than the previous coarse grouping. Reuse original checkpoint boundaries where that is already reviewable; split duplicated commits further when a checkpoint mixes unrelated concerns.
- Resolve conflicts immediately on the duplicated branch only. Never solve a conflict by editing the original branch.
- Calculate content hashes throughout the rewrite so content drift is caught as soon as it happens.

## Acceptance Criteria

- [ ] `jj log -r 'wwz::@'` shows a new duplicated stack above `wwz`; the original `xnz..ktv` range is still present and unchanged.
- [ ] No commit before `wwz` was modified.
- [ ] The duplicated tip hash over all paths outside `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**` matches `ktv` exactly.
- [ ] The hash over the active task directory remains unchanged throughout duplication unless this task intentionally edits its own artifacts.
- [ ] `jj diff --from ktv --to <duplicated-tip> --summary` is limited to the expected current-task files, or any additional difference is explicitly documented before handoff.
- [ ] The duplicated stack uses descriptive commit messages instead of `WIP`/checkpoint names.
- [ ] Any conflicts introduced while duplicating or splitting are resolved before handoff.

## Out of Scope

- Cleaning up or deleting the original `xnz..ktv` source stack.
- Re-designing the code beyond what already exists in the source tip.
- Reworking unrelated history outside the `rtn` / `wwz` / `xnz..ktv` neighborhood.

## Technical Notes

- Observed source chain: `xnz -> ssozvols -> qtrkpvqv -> uqlwpsuk -> kxmnywsn -> swoktlnl -> qzwyuwry -> unztxqlp -> rxpnurol -> wmvtspqm -> uonwpysk -> ktmzsmov -> nytkkxmr -> zooqvnpp -> xnkprunt -> ykwuunwx -> opxtyxky -> purwkwmo -> sptnknvq -> wsworlsu -> ssuqwkky -> ktv`.
- `wwz` is a sibling branch from `rtn`, not an ancestor of `ktv`.
- Initial normalized hash observations:
  - `ktv` SHA-256 excluding `.trellis/tasks/06-05-reorganize-architecture-cleanup-commits/**`: `6c3c52bab4f6b9de194e30d5b05cecad853f12f1bbe8d50270ce62c60cbd9dd1`
  - current task-directory SHA-256 at the working copy: `9f9dae16902d9c9b98e2341cdb5ce10390ad0ebf4219130c65afa626e676deb6`
