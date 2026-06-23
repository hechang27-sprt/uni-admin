<!-- NUXT-AUTOIMPORT:START -->

# Nuxt Autoimport Warning

Here are the directories Nuxt auto-imports from:

- **`app/components/`** — Vue components, available in templates globally
- **`app/composables/`** — composables (e.g. `useMyThing.ts`)
- **`app/utils/`** — helper functions and utilities
- **`server/utils/`** — server-side functions and variables

<!-- NUXT-AUTOIMPORT:END -->

<!-- HEADROOM-WARNING:START -->

# Headroom Tool Call Compression Warning

Warning: tool call results may appear mangled as a result of compression via Headroom proxy.
Do NOT assume actual syntax error in code unless corroborated by LSP or typechecker.
DO NOT TRY TO BYPASS THE COMPRESSION via code

<!-- HEADROOM-WARNING:END -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **uni-admin** (699 symbols, 1978 relationships, 58 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/uni-admin/context` | Codebase overview, check index freshness |
| `gitnexus://repo/uni-admin/clusters` | All functional areas |
| `gitnexus://repo/uni-admin/processes` | All execution flows |
| `gitnexus://repo/uni-admin/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- agent-skills:start -->
## Agent skills

### Issue tracker

Issues are tracked in this repo’s GitHub Issues; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Domain docs are configured as single-context: one root `CONTEXT.md` plus root `docs/adr/`. See `docs/agents/domain.md`.
<!-- agent-skills:end -->
