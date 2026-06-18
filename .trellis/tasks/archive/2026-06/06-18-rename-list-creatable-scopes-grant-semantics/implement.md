# Implementation Plan — rename listCreatableScopes grant semantics

## Ordered checklist

1. **Rename public/service grant APIs**
   - rename `DocumentService.listCreatableScopes()` to `listCreateGrants()`
   - remove `AuthRbacService.listCreatableDocumentScopes()` and use `listGrantedScopesForCapability()` directly, or rename consistently if a wrapper remains
   - update exported types/callsites with no alias shim

2. **Rename descendant-filter terminology**
   - rename `accessibleScopeIds`-style values in document service, document types, and repository/query helpers to filter-oriented names
   - rename `buildAccessibleDocumentScopeFilter()` to a name that makes clear it derives a document access filter from grant rows
   - preserve behavior; names only, unless a tiny local cleanup is required by the rename

3. **Cut document-service special casing**
   - remove `resourceScope`-based branching from the renamed document-service grant API
   - always resolve the create capability key and return direct grant rows from auth service
   - keep the `!auth -> []` early return

4. **Preserve real authorization behavior**
   - leave `authorizeCreate()` resource-scope target translation behavior intact
   - confirm tenant-root and bottom restrictions still live only in actual create authorization
   - keep internal grant-row consumers explicit about flattening or null handling

5. **Rename and update tests**
   - rename tests that talk about creatable scopes so they talk about create grants
   - rename local test variable names that still imply `accessibleScopes` means granted scopes
   - assert that `document`, `tenant-root`, and `none` collection modes return the same direct grant rows for the same actor
   - keep separate assertions that actual create authorization still differs by mode

6. **Verify**
   - run the directly affected auth RBAC test file
   - run typecheck

## Validation commands

```bash
bun test test/unit/server/auth-rbac.test.ts
bun run typecheck
```

## Rollback note

If the rename starts forcing broader authorization changes, stop and revert to the settled boundary: rename/grant-contract only, authorization semantics unchanged.
