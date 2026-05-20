# Jujutsu + Git Workflow

This repository is a colocated Jujutsu + Git repository. When `.jj/` exists,
use Jujutsu as the local change-management source of truth and keep Git as the
remote/compatibility layer.

## Detection

Before reasoning about branch, dirty-state, or commit behavior, check:

```bash
test -d .jj && jj status
git status --short --branch
```

Detached Git `HEAD` is expected in a Jujutsu-managed working copy and is not a
problem by itself. Treat `jj status` as authoritative for the local working
copy when `.jj/` exists.

## Inspecting Changes

Prefer these commands in Jujutsu repositories:

```bash
jj status
jj diff --name-only
jj log --limit 5
```

Use Git checks as compatibility/fallback:

```bash
git status --short --branch
git log --oneline -5
```

## Commit Planning

Keep the Trellis safety model:

- Include only files edited by the current task/session.
- List unrecognized dirty files separately.
- Never silently include user changes.
- Never push unless the user explicitly asks.

For batched commits, use explicit filesets:

```bash
jj commit -m "message" path/to/file another/path
```

Do not use bare `jj commit -m "message"` for a planned batch unless every dirty
path belongs in that commit. Without file arguments, `jj commit` commits the
whole working-copy change and creates a new working-copy change on top.

When `.jj/` is absent, use the Git workflow described in `.trellis/workflow.md`.

## Branch-only Example Work

For demo/example work that should not land in the default starter runtime,
create a separate Jujutsu change/bookmark rather than assuming Git branch
checkout semantics:

```bash
jj bookmark create example/name
```

or, when moving/setting a bookmark intentionally:

```bash
jj bookmark set example/name
```

Keep example/demo changes separate from product/runtime changes and do not push
bookmarks unless the user explicitly asks.

## Agent Skill Use

For ordinary task work, direct `jj` CLI commands are enough. If the user asks
for advanced Jujutsu coordination, learning, or multi-agent version-control
behavior, load the available `agentic-jujutsu` skill before choosing commands.
