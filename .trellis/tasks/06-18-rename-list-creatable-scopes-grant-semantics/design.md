# Design — rename listCreatableScopes grant semantics

## Problem

The current API names blur two different concepts:

- direct create-capability grants
- descendant-derived document access filters

Examples:

- `DocumentService.listCreatableScopes()`
- `AuthRbacService.listCreatableDocumentScopes()`
- `accessibleScopeIds` / `buildAccessibleDocumentScopeFilter()`

But the tractable and now-settled behavior is different:

- create-grant listing returns direct grant rows for the collection `create` capability
- document-list filtering derives a concrete descendant-aware filter from those grants
- grant listing includes `roleId` provenance and may include `scopeId = null` explicit bottom grants
- grant listing does not expand descendant scopes or vary by collection `resourceScope`

That makes the current names semantically wrong in both directions.

## Settled contract

### Document-service grant API

Rename `DocumentService.listCreatableScopes()` to a grant-oriented name.

Recommended name:

- `listCreateGrants()`

Return type stays:

```ts
GrantedScopes[]
```

where:

```ts
interface GrantedScopes {
  roleId: string;
  scopeId: string | null;
}
```

Semantics:

- direct assignment facts only
- no descendant expansion
- no filtering by `resourceScope`
- `scopeId = null` means explicit bottom-scope grant

### Auth service grant API

Rename `listCreatableDocumentScopes()` to match the same contract.

Recommended names:

- `listCreateCapabilityGrants()` for the document-facing path, or
- collapse the extra wrapper and use `listGrantedScopesForCapability()` directly from the document service

Preferred boring cut:

- keep one generic auth-service helper: `listGrantedScopesForCapability()`
- remove the misleading `listCreatableDocumentScopes()` wrapper entirely
- have document service call the generic helper directly

This avoids two names for the same behavior.

## Behavior by collection mode

`resourceScope` does not change grant-list output.

For the same actor and the same collection create capability:

- `document`
- `tenant-root`
- `none`

all return the same direct granted rows.

`resourceScope` continues to matter only in:

- `authorizeCreate()`
- any target translation helpers used by actual create authorization

## Callsite implications

### Document service

Today `listCreatableScopes()` branches on `auth.resourceScope` and special-cases:

- `document` → `listCreatableDocumentScopes()`
- non-document → authorize and return `[null]` or `[]`

That logic must be removed. The renamed method should instead:

1. require actor options
2. resolve collection create auth
3. if no create auth, return `[]`
4. build permission key
5. return `authorizer.listGrantedScopesForCapability(...)`

No `resourceScope` branching.

### Document create authorization

Do not change the meaning of actual authorization:

- `document` still checks translated document auth-scope targets
- `tenant-root` still requires tenant-root target authorization
- `none` still checks bottom target authorization

The rename/refactor must preserve these checks.

### Filter helper

`buildAccessibleDocumentScopeFilter()` already consumes grant rows and flattens them to concrete scope ids for list filtering. That can remain behaviorally, but its naming should change to filter-oriented terminology so it does not read like a direct-grant API. The same applies to `accessibleScopeIds` values passed through document list/repository/query helpers: they represent a descendant-derived document access filter, not the actor's granted scopes.

## Risk and blast radius

- `DocumentService.listCreatableScopes` GitNexus upstream impact: LOW, 0 indexed callers.
- Real affected surface is local and test-covered: service/auth types, tests, and any local callsites.
- Main risk: conflating grant-list rename with actual authorization behavior changes. Avoid that.

- `server/data/documents/service/service.ts`
- `server/data/documents/types.ts`
- `server/data/documents/repository/kysely.ts`
- `server/data/documents/repository/query.ts`
- `server/auth/um/service.ts`
- `server/auth/um/repository.ts` (maybe signature only)
- `server/auth/um/types.ts`
- `server/auth/um/index.ts`
- `test/unit/server/auth-rbac.test.ts`
- spec docs only if implementation teaches a new durable contract beyond current wording

## Non-goals

- no descendant materialization
- no evaluator rewrite
- no new compatibility alias exports
- no schema/query shape change beyond names/signatures needed by the rename
