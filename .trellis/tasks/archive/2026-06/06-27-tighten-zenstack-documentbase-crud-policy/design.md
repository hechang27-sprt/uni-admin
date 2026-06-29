# Design — tighten ZenStack prototype DocumentBase CRUD policy

## Problem

`DocumentBase` currently authorizes CRUD with two shortcuts that no longer match the intended RBAC semantics:

1. capability matching is suffix-based (`endsWith(..., ':read')`), which lets a grant for one collection satisfy another collection's CRUD verb;
2. scope matching handles ancestor/self through `authScope.path`, but does not model the explicit bottom-scope asymmetry the project now standardizes.

## Decision

Keep the current working prototype architecture, but tighten the base policy and seed data in three specific ways.

### 1. Exact capability-key matching

Use the row discriminator as the source of truth for collection/app identity:

- `concat(this.qualifiedCollectionKey, ':', '<verb>')`

This is enough to cover both collection-key and app-key alignment because `qualifiedCollectionKey` is already `<app-key>:<collection-key>`.

Result: a `default:projects:read` grant can no longer read `default:locked-documents` or any sibling collection.

### 2. Explicit bottom-scope semantics

Introduce a prototype-level bottom-scope constant row in `AuthScope` and treat bottom-target document rows distinctly.

Policy rule:

- Non-bottom row: grant scope must be the row scope or one of its ancestors via `this.authScope.path`.
- Bottom row: allow either
  - an explicit bottom grant (`g.grantScopeId == BOTTOM_SCOPE_ID`), or
  - any concrete non-bottom grant within the same tenant.

This matches the asymmetric project rule: concrete grants flow downward to bottom; explicit bottom grants stay bottom-only.

### 3. Keep the closure/path approach boring

Do not re-open the failed deep nested closure traversal experiment. The current prototype already proved that ZenStack policy handles direct checks against row-owned scalar fields and `authScope.path`. Reuse that shape.

## Schema impact

### `AuthScope`

Add/seed an explicit bottom scope row with the all-zero UUID used by the project guidance.

### `DocumentBase`

Policy only. The shared physical row contract stays unchanged.

### `DerivedCapabilityGrant`

No structural change required. Existing `capabilityKey` + `grantScopeId` fields are sufficient for the tighter policy.

## Runtime / test impact

Seed:

- bottom scope row;
- one bottom-scoped project document;
- one actor context with exact `default:projects:*` grants at root scope;
- one second actor context with only bottom-scoped `default:projects:read` grant to prove bottom-only asymmetry.

Test:

- exact capability-key alignment blocks cross-collection access;
- root-scoped grant can read/update descendant project row and read bottom project row;
- explicit bottom grant can read bottom project row;
- explicit bottom grant cannot read/update non-bottom project row;
- locked subtype deny still composes on top.

## Risks

- ZenStack policy may be picky about string concatenation helpers in `@@allow`; validate with `zen generate` first.
- Bottom-scope semantics depend on how the prototype encodes the bottom row in `authScope.path`; seed it explicitly and keep the predicate simple.
- [INFERENCE] If ZenStack rejects a helper like `concat`, we may need to denormalize the exact capability key onto the row or switch to another supported string expression.

## Rollback shape

If the exact-match expression is unsupported, fall back to the smallest working equivalent that still preserves exact collection/app alignment, and record the limitation in `NOTES.md`.
