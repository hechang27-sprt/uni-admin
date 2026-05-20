# Jujutsu-aware Trellis workflow/spec Design

## Architecture

This is a local Trellis customization task. It updates the project-local
workflow/spec/skill guidance so AI agents treat this repository as a colocated
Jujutsu + Git repository instead of a plain Git-only working tree.

The core rule is:

- Use Jujutsu as the local change-management source of truth when `.jj/` is
  present. This `jj`-first direction is confirmed for implementation.
- Keep Git compatibility for remotes, existing Trellis scripts, and fallback
  repos that do not use Jujutsu.
- Do not push from agent workflow unless the user explicitly asks.

## Affected Layers

Primary targets:

- `.trellis/workflow.md`
- `.trellis/spec/guides/`
- `.agents/skills/trellis-start/SKILL.md`
- `.agents/skills/trellis-check/SKILL.md`
- `.agents/skills/trellis-finish-work/SKILL.md`
- `.agents/skills/trellis-continue/SKILL.md`

Secondary review targets:

- `.trellis/config.yaml`
- `.trellis/scripts/`
- platform settings under `.codex/` and `.vscode/`

Script behavior should not be changed in this task unless a workflow/spec edit
would otherwise become misleading. The MVP is guidance-level compatibility, not
a rewrite of Trellis task/archive internals.

## Jujutsu-aware Workflow Rules

When `.jj/` exists, agents should inspect both Jujutsu and Git state:

- `jj status`
- `jj log -r '::@' --limit 5` or equivalent recent-change view
- `git status --short --branch`

Detached Git `HEAD` is not by itself a problem in a Jujutsu-managed working
copy. Agents should avoid treating detached `HEAD` as a blocker if `jj status`
shows a valid working copy.

Dirty-state classification still follows the existing Trellis safety rule:

- AI-edited files from this session can be included in an agent-proposed change.
- Unrecognized dirty files are reported separately and never silently included.
- User changes are not reverted.

## Commit Guidance

In a Jujutsu repo, Phase 3.4 should prefer a Jujutsu-first flow:

1. Inspect dirty state with `jj status`.
2. Also inspect Git state with `git status --short --branch` for compatibility.
3. Learn message style from recent history using a `jj log` view first, with
   `git log --oneline -5` as fallback.
4. Present the same one-shot commit plan Trellis already requires.
5. On confirmation, create logical work commits with Jujutsu operations.

The implementation should choose concrete commands conservatively. Expected
candidate commands:

- `jj status`
- `jj diff --name-only`
- `jj log --limit 5`
- `jj commit -m "<message>" <files...>` for planned file batches. `jj commit`
  without file arguments commits the whole working-copy change, so batched
  commits must pass explicit filesets when only part of the dirty state belongs
  to the batch.
- `jj bookmark create <name>` or `jj bookmark set <name>` when branch/bookmark
  naming is needed for branch-only example work

Git remains the fallback when `.jj/` is absent.

## Branch-only Demo Work

The future data-layer demo fixture should not be embedded in product PRDs as a
workflow concern. The Trellis workflow/spec should instead document how an agent
creates branch-only/example work in this repository:

- Use Jujutsu-aware branch/bookmark guidance when `.jj/` is present.
- Keep demo/example changes separate from default starter runtime changes.
- Do not push demo branches unless explicitly asked.

## Compatibility

Existing Trellis scripts may still use Git for archive/journal commits. This
task should not break those scripts. If a script needs Git-visible commits, the
guidance must explain the hybrid handoff rather than pretending all Git
integration disappears.

## Trade-offs

Jujutsu-first guidance avoids detached-`HEAD` confusion and matches the actual
working-copy model. Keeping Git as fallback and compatibility layer prevents
the local Trellis customization from becoming unusable in repos that do not use
Jujutsu or in scripts that still assume Git.

The task intentionally avoids changing product planning docs. Repository
workflow mechanics belong in Trellis workflow/spec/skill guidance.
