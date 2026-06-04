# Design — Scope-root document auth filtering

## Problem

The current document-read filtering path expands authorized scopes to every descendant scope id:

1. `AuthRbacRepository.listAccessibleScopeIds(...)` returns `descendantId`s.
2. `AuthRbacService.listAccessibleDocumentScopeIds(...)` normalizes tenant root to `null`.
3. `DocumentService.list(...)` passes the expanded set into repository filtering.
4. `DocumentService.getByIds(...)` cannot cheaply reuse that shape, so it loads docs first and filters them in memory.

This makes the data volume proportional to scope-tree size rather than the actor's effective grants.

## Goals

- Make authorized-scope data scale with grant count, not descendant count.
- Preserve current auth-policy ownership boundaries.
- Push structural containment filtering into document SQL where it belongs.
- Keep existing service-facing behavior stable where required, while acknowledging that positional `null` array semantics are legacy and not a preferred shape for future APIs.

## Non-Goals

- Redesign `evaluateAccess(...)` as the primary authorization engine.
- Move capability policy into document repository methods.
- Change write-path authorization behavior.
- Redesign current public read APIs to keyed/object outputs inside this task.

## Proposed API Shape

### Auth repository/service

Add a new repository method with grant-root semantics:

```ts
interface AuthRbacRepository {
  listGrantedScopeIdsForCapability(input: {
    tenantId: string;
    userId: string;
    capability: string;
  }): Promise<Array<string | null>>;
}
```

Service wrapper:

```ts
class AuthRbacService {
  async listGrantedScopeIdsForCapability(input: ListAccessibleScopesInput): Promise<Array<string | null>>;
}
```

Behavior:
- `AuthRbacService` still calls `evaluateAccess({ checks: [], permissionKeys: [capability], throw: true })` first to validate actor membership and permission existence.
- Repository returns distinct scope ids where the actor effectively holds the capability.
- The returned array may legitimately include both `null` and concrete scope ids. That is acceptable because the underlying grants may exist at tenant root and also at narrower scopes.
- `null` in this returned set means tenant root.

### Document repository

Overload `findByIds(...)` with an optional structural scope-filter input:

```ts
interface DocumentRepository {
  findByIds<TData extends JsonObject>(input: {
    tenantId: string;
    collection: string;
    ids: string[];
    includeDeleted?: boolean;
    accessibleScopeIds?: string[] | null;
  }): Promise<(StoredDocument<TData> | null)[]>;
}
```

Why overload instead of sibling method:
- Matches the preferred API direction for this task.
- Keeps the structural filter close to the existing identity-read primitive.
- Avoids multiplying repository entry points for one query family.

Tradeoff:
- The method contract becomes more loaded, so the new parameter must stay explicitly structural/pre-authorized rather than actor-aware.

Normalization boundary:
- Auth-facing APIs may use `Array<string | null>`.
- Document repository filtering should normalize that to `string[] | null | undefined` before query construction.
- In the repository contract, `undefined` and `null` are semantically equivalent: both mean no scope-level filtering.
- `[]` is distinct and means no scoped documents are accessible.

## Structural Filtering Rule

When `accessibleScopeIds` is `undefined` or `null`:
- `findByIds(...)` behaves exactly as it does today with respect to scope filtering.
- The repository contract does not distinguish between these two values.

When `accessibleScopeIds` is a non-empty `string[]`:
- a document is visible iff its `authScopeId` is non-null and there exists an `auth_scope_closure` row whose:
  - `ancestor_id` is one of `accessibleScopeIds`, and
  - `descendant_id` equals `documents.auth_scope_id`
- root-scoped documents (`authScopeId: null`) are not visible in this branch

When `accessibleScopeIds` is `[]`:
- no scoped documents are accessible
- preserve caller order / row shape, but all existing scoped documents resolve to denied/null at current service boundaries

This is structural containment only. The caller is responsible for ensuring `accessibleScopeIds` were derived from a validated actor + capability.

## SQL Sketch

For overloaded `findByIds(...)`:

- Build ordered `input(id, input_order)` relation from requested ids.
- Left join documents by `(tenant_id, collection, id)`.
- Preserve `includeDeleted` behavior.
- If `accessibleScopeIds` is `undefined` or `null`, keep current query shape.
- If `accessibleScopeIds` is `[]`, return no scope-authorized document matches.
- Otherwise:
  - build `allowed(scope_id)` relation from `accessibleScopeIds`
  - add `exists(select 1 from auth_scope_closure c join allowed a on a.scope_id = c.ancestor_id where c.descendant_id = documents.auth_scope_id)`
- Keep output ordered by `input_order` and preserve `null` rows for missing or filtered-out docs to satisfy current service contracts.

## Service Flow Changes

### `DocumentService.getByIds(...)`

Current:
- `findByIds(...)`
- `filterAccessibleDocuments(...)` in memory

Proposed:
- if no actor or no read auth declaration: keep existing `findByIds(...)`
- else:
  1. ask auth service for `grantedScopeIds: Array<string | null>`
  2. normalize for repository input:
     - if `grantedScopeIds` contains `null`, pass `accessibleScopeIds: null`
     - else pass distinct concrete scope ids as `string[]`
  3. call overloaded `findByIds({ ..., accessibleScopeIds })`
- result already preserves caller order and `null` for missing/denied entries

This preserves the current service contract even though the positional-`null` shape is not ideal.

### `DocumentService.list(...)`

Current:
- asks auth service for expanded document scope ids (`null` normalized)
- passes `authScopeIds` filter to repository list query

Proposed:
- ask auth service for `grantedScopeIds: Array<string | null>`
- normalize to repository filter input:
  - `null` if the returned set contains tenant root
  - otherwise deduped `string[]`
- pass that structural shape into repository list filtering
- if normalized `accessibleScopeIds` is `null`, skip auth-scope filtering entirely for that tenant/collection query
- otherwise apply ancestor/descendant containment instead of `IN (expandedScopeIds)` filtering

### `listCreatableScopes(...)` / scope-list helpers

Keep current public helper behavior for this task unless changing them is required to support the new grant-root lookup.

Recommended MVP:
- update internal auth lookup plumbing only as needed
- do not broaden the task into a full redesign of public scope-list helper outputs

## Tradeoffs

### Pros
- Data returned from auth lookup scales with grants, not subtree size.
- `getByIds(...)` no longer needs in-memory authorization filtering.
- Repository owns structural scope containment, which is where SQL excels.
- Treating `null` and `undefined` the same keeps the repository contract simple and non-semantic.
- Keeps policy checks centralized in auth service.

### Cons
- Overloading `findByIds(...)` makes the method contract less crisp.
- Document repository queries become more complex.
- `list(...)` needs a structural filter representation instead of simple `authScopeIds`.
- Future keyed/object-shaped read contracts remain deferred.

## Risks

- Mishandling normalization from `Array<string | null>` to `string[] | null` could leak or hide documents.
- Overloaded `findByIds(...)` may be misused if the parameter is treated as general-purpose instead of pre-authorized structural input.
- If scope-list helper behavior is changed in the same task, blast radius grows beyond document reads.

## Recommended Decision

- Add `listGrantedScopeIdsForCapability(...)` to auth repository/service, returning `Array<string | null>` where `null` means tenant root.
- Overload `DocumentRepository.findByIds(...)` with optional `accessibleScopeIds?: string[] | null`.
- Treat `accessibleScopeIds === null` and `accessibleScopeIds === undefined` identically in the repository contract.
- Treat `accessibleScopeIds === []` as a meaningful empty-access filter.
- Introduce the same normalized structural filter shape for `list(...)`.
- Limit this task’s implementation scope to document-read flows (`getByIds`, `list`) and supporting repository/auth APIs.
- Preserve existing positional-`null` service outputs for now; treat keyed/object-shaped results as a separate follow-up redesign if desired.
