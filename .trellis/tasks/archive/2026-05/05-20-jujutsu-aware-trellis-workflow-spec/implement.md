# Jujutsu-aware Trellis workflow/spec Implementation Plan

## Checklist

- [x] Re-read `.trellis/workflow.md` Phase 3.4 and workflow-state blocks before
      editing.
- [x] Re-read `trellis-start`, `trellis-check`, `trellis-finish-work`, and
      `trellis-continue` skill files before editing.
- [x] Add a project-local spec guide for colocated Jujutsu + Git workflow.
- [x] Link the new guide from `.trellis/spec/guides/index.md`.
- [x] Update `.trellis/workflow.md` Phase 3.4 to be Jujutsu-aware:
      `jj status` first when `.jj/` exists, Git status as compatibility check,
      Jujutsu commit guidance, Git fallback.
- [x] Make batched Jujutsu commit guidance use explicit filesets for each
      planned file group, because plain `jj commit -m` commits the whole
      working-copy change.
- [x] Update workflow guidance so detached Git `HEAD` is not treated as a
      problem by itself in a valid Jujutsu working copy.
- [x] Update branch-only/demo guidance in workflow/spec so future example
      branches use Jujutsu-aware commands.
- [x] Update `trellis-check` changed-file identification to prefer `jj` state
      when `.jj/` exists and fall back to Git otherwise.
- [x] Update `trellis-finish-work` dirty-state survey wording so it inspects
      Jujutsu state and recognizes Git compatibility state.
- [x] Update `trellis-start` / `trellis-continue` wording only if their Git
      state references would otherwise mislead agents.
- [x] Avoid modifying product PRD/design files for repository workflow rules.
- [x] Keep Git fallback instructions for non-Jujutsu repos and existing Trellis
      scripts.

## Validation Commands

- `jj status`
- `git status --short --branch`
- `rg -n "git status|git commit|git log|jj status|Jujutsu|jujutsu" .trellis/workflow.md .agents/skills .trellis/spec`
- Manual review that `.trellis/workflow.md` still has matching
  `[workflow-state:*]` open/close tags.
- Manual review that the new guide is linked from `.trellis/spec/guides/index.md`.

## Risk Points

- Breaking existing Trellis scripts that still create Git commits.
- Making guidance too Jujutsu-specific and unusable in a Git-only clone.
- Treating detached Git `HEAD` as an error even though Jujutsu owns the working
  copy.
- Accidentally mixing repository workflow mechanics back into product task
  PRDs/designs.
- Using unsupported or locally unavailable `jj` command variants.

## Rollback Points

- `.trellis/workflow.md`
- `.agents/skills/trellis-check/SKILL.md`
- `.agents/skills/trellis-finish-work/SKILL.md`
- `.agents/skills/trellis-start/SKILL.md`
- `.agents/skills/trellis-continue/SKILL.md`
- `.trellis/spec/guides/index.md`
- new Jujutsu workflow guide under `.trellis/spec/guides/`

## Follow-Up Checks Before Start

- Direction confirmed: use `jj`-first with Git fallback when `.jj/` exists.
