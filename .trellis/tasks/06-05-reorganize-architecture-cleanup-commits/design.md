# Design — Reorganize architecture cleanup commits

## Problem

The jj range from `xnz` through `ssu` captures a real architectural cleanup, but the history is not reviewable as-is:

- most changes are named `WIP: checkpoint*`
- unrelated concerns are interleaved inside the same commits
- pure bookkeeping churn (journals / archived task moves) sits beside product code
- later auth/document fixes are layered on top of the refactor without commit boundaries that explain why they exist

A reviewer currently has to reconstruct intent from file lists instead of from the commit graph.

## Goals

- Produce a small commit stack whose boundaries match the actual work.
- Preserve the final tree represented by `ssu` unless a deliberate cleanup difference is called out.
- Make each commit explainable by one sentence and one review focus.
- Separate operational bookkeeping from product/tooling history.
- Leave a safe rollback path using jj operations.

## Non-Goals

- Invent new architecture beyond what is already in `ssu`.
- Rewrite code purely to make commits prettier.
- Preserve every original checkpoint as a distinct historical artifact.
- Solve unrelated cleanup outside `xnz..ssu`.

## Observed Change Families

### 1. Tooling / workflow bootstrap

Files under `.omp/**`, `.trellis/**`, `AGENTS.md`, `CLAUDE.md`, `.omp/lsp.json`, `package.json`, `bun.lock`, and `nuxt.config.ts` represent local workflow/tooling setup rather than server architecture.

This work is real, but it should not be mixed into server refactors.

### 2. Server boundary refactor

Files under:

- `server/auth/**`
- `server/data/documents/**`
- `server/db/**`
- `server/di/**`
- `server/utils/pivot.ts`
- docs/spec/test files tied to those moves

represent the main architecture cleanup: stronger separation between auth, document data access, service logic, and DI/query helpers.

### 3. Shared query / utility extraction

`server/utils/unnest.ts`, its tests, and nearby auth repository query reshaping form a narrower sub-theme. They may belong either:

- inside the broader refactor commit, if the diff is still reviewable, or
- in a dedicated utility/query-support commit, if that makes the server refactor easier to review.

Recommended default: keep utility/query extraction separate if it materially reduces the size of the main refactor review.

### 4. Auth/document behavior fixes after the refactor

Later commits change behavior, not just structure:

- capability evaluation / auth repository/service adjustments
- `resourceScope: none` semantics
- scope-root document auth filtering
- corresponding unit-test updates

These should be isolated from the architectural moves so reviewers can distinguish:

- what changed structurally
- what changed semantically

### 5. Bookkeeping-only churn

Journal updates and archived task-directory moves are operational history. They do not explain the product changes.

Recommended default: drop these from the cleaned stack unless there is a project-specific requirement to preserve them in shared history.

## Proposed Target Stack Shape

Recommended stack, from oldest to newest:

1. `chore: bootstrap trellis and local omp tooling`
   - `.omp/**`, relevant `.trellis/**` template/spec files, `AGENTS.md`, `CLAUDE.md`, config/package lock updates directly required by that setup
2. `refactor(server): separate auth, documents, and DI boundaries`
   - core server module moves/splits, query entry points, DI container/tokens, public module surface cleanup, associated docs/spec updates that explain the architecture
3. `refactor(server): extract query utilities and add unnest coverage`
   - `server/utils/unnest.ts`, related auth repository query cleanups, `test/unit/server/unnest.test.ts`, spec/test notes if needed
4. `fix(auth): tighten capability evaluation and scope-none semantics`
   - capability batching / auth service-repository semantics / relevant tests
5. `fix(documents): filter reads by granted scope roots`
   - scope-root document filtering and its test coverage
6. optional: `chore: configure local lsp`
   - keep separate if `.omp/lsp.json` and lockfile changes are small and independent enough

This is a target shape, not a hard requirement. If split mechanics show a more natural 4-commit or 7-commit stack with cleaner boundaries, prefer clearer review units over matching this outline exactly.

## Rewrite Strategy

Use jj history editing rather than content reimplementation:

- `jj edit <change>` to move to the commit being rewritten
- `jj split` to carve mixed changes into smaller commits
- `jj new` to create explicit sibling/follow-up commits
- `jj rebase -s <source> -d <destination>` to restack after splits
- `jj describe -m ...` to replace checkpoint messages with durable commit messages
- `jj abandon <change>` for dropped bookkeeping-only commits
- `jj undo` if any rewrite step groups content incorrectly

## Invariants During Rewrite

- The final content at the rewritten tip should match `ssu` unless an intentional bookkeeping cleanup is being dropped.
- No commit should mix Trellis/journal/archive churn with server behavior changes.
- Behavior-fix commits should carry the tests that prove those fixes.
- If a commit cannot stand alone cleanly because of dependency shape, keep the dependency in the older commit rather than forcing an artificial split.

## Review / Verification Model

Because this task rewrites history rather than changing intended behavior, the primary verification is graph and tree equivalence:

- compare rewritten tip to `ssu`
- inspect rewritten `jj log` and per-commit summaries
- ensure the stack reads cleanly in order

Only run code-level tests if the rewrite requires content edits beyond pure regrouping.

## Risks

- Over-splitting can create commits that do not make sense independently.
- Under-splitting leaves the same reviewability problem unsolved.
- Dropping bookkeeping changes without noticing a meaningful tracked artifact would lose intended repo state.
- Reordering behavior fixes ahead of required refactor scaffolding could create misleading history.

## Recommended Decision

- Rewrite `xnz..ssu` into concern-based commits.
- Drop journal-only and archive-only changes from the cleaned stack.
- Keep workflow/tooling setup separate from server architecture work.
- Keep auth/document semantic fixes separate from structural refactors.
- Prefer a slightly larger stack over a smaller mixed one when that improves reviewability.