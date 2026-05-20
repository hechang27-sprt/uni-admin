# Jujutsu-aware Trellis workflow/spec

## Goal

Make this project's Trellis workflow and specs aware that the repository uses
colocated Jujutsu + Git, so future task branching, demo branches, dirty-state
inspection, commit planning, finishing, and journaling guidance do not assume a
plain Git-only workflow.

## Requirements

- Treat this as a Trellis meta/workflow task, separate from product/data-layer
  PRDs and designs.
- Inspect the local Trellis workflow, project specs, and platform skills before
  editing; local files are authoritative.
- Preserve compatibility with Git remotes and existing Trellis scripts that may
  still shell out to Git.
- Add guidance for detecting colocated Jujutsu + Git repositories, including
  checking `jj status` alongside Git state.
- Update task branching guidance so branch-only/demo work can be created with
  Jujutsu-aware operations instead of assuming `git checkout -b` semantics.
- Update commit/finish guidance so agents understand whether to use `jj`
  operations, Git operations, or a documented hybrid path.
- Use a `jj`-first workflow with Git fallback/compatibility whenever `.jj/`
  exists.
- Clarify how to handle detached Git `HEAD` when Jujutsu owns the working copy.
- Clarify how to classify dirty files and avoid accidentally including user
  changes in a `jj` working-copy commit.
- Preserve the existing Trellis rule that agents must not push without explicit
  user request.
- Consider whether a project-local skill/spec should mention the available
  `agentic-jujutsu` skill, and when it should be used.
- Keep data-layer/product task artifacts free of repository workflow mechanics.
- Document how branch-only demo fixtures should be handled once the data-layer
  implementation reaches that point.

## Acceptance Criteria

- [x] `.trellis/workflow.md` no longer assumes plain Git-only commands where a
      colocated Jujutsu + Git workflow requires different guidance.
- [x] Relevant `.trellis/spec/` guidance documents Jujutsu-aware task
      branching, dirty-state inspection, and commit/finish behavior.
- [x] Relevant project-local skills or command guidance mention `jj` where
      agents currently rely on Git-only checks.
- [x] Guidance explains how to inspect both `jj status` and Git state without
      treating detached Git `HEAD` as inherently wrong in a Jujutsu-managed
      working copy.
- [x] Guidance preserves Git remote compatibility and does not remove Git from
      workflows that still need it.
- [x] Guidance includes a branch-only/demo workflow note suitable for future
      data-layer demo fixtures, without embedding that workflow note in product
      PRDs/designs.
- [x] No product task PRD/design is used as the source of truth for Jujutsu
      workflow mechanics.

## Notes

- Evidence already observed:
  - `jj status` reports a Jujutsu working copy commit and parent commit.
  - `git status --short --branch` reports detached `HEAD`.
  - `.trellis/workflow.md` Phase 3.4 currently documents Git-only commit
    commands.
  - `trellis-finish-work`, `trellis-check`, `trellis-start`, and
    `trellis-continue` skill text currently references Git state/commits.
- This is a meta task. It should use `trellis-meta` before implementation.
- Decision confirmed: implementation should be `jj`-first with Git fallback
  when `.jj/` exists.
