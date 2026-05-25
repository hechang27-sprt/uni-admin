# Batch-Only Database Primitives Design

## Architecture

The refactor keeps existing service classes as the public TypeScript API and
changes the internal persistence/authorization contract:

```text
scalar or batch service API
  -> validation and operation policy resolution
  -> batch repository / batch authorizer primitive
  -> set-based Drizzle/PostgreSQL statement(s)
```

The word “batch” applies to repeated and naturally bulk-capable database access
primitives. A scalar service call uses a one-item batch when it targets such a
primitive. Inherently singular workflows may retain scalar accessors when a
set-shaped method would not remove a repeated statement. Workflows that have
genuinely separate phases, such as checking authorization before a remote
mutation, are not collapsed across those safety boundaries.

## Boundaries

### Document Repository

Document item reads and writes are naturally bulk-capable and are expected to
feed imports, generated tables, operations, and existing batch APIs. Replace
scalar item database accessors with set-shaped operations:

- insert accepts records and returns matching created documents.
- find-by-id accepts IDs and preserves positional `null` results.
- update accepts versioned records and preserves existing conflict behavior.
- hard delete accepts document identities and returns deleted identities or
  positional status.
- remote projections stay batched.
- list remains a query operation, because it already returns a collection and
  is not an item-at-a-time accessor.

Existing public service methods `create`, `getById`, `update`, `patch`,
`softDelete`, `restore`, `hardDelete`, `remoteUpdate`, and `remoteDelete`
continue to return scalar values by passing one record to these batch
primitives.

### Authorization Boundary

Replace scalar `DocumentAuthorizer.checkAccess` / repository access checking
with an operation that accepts multiple `(capability, targetScopeId)` checks,
deduplicates equivalent requests, and returns results aligned to input order.

Document batch paths will:

1. Resolve one collection operation capability.
2. Collect distinct target scopes from the documents or requested creations.
3. Call the batched authorizer once for those checks.
4. Project the results back onto input items.

The accessible-scope list operation remains collection-shaped, but should
return document-compatible nullable target scope IDs without a separate root
normalization lookup.

### Auth/RBAC Repository

Use set-shaped repository primitives for current or expected repeated paths:

- permission definition upsert and role-permission grants;
- role assignments where setup/admin workflows may apply multiple entries;
- access checks, because document batch APIs and delegated administration
  already need multiple checks;
- accessible scope listing, which is already collection-shaped.

Retain scalar primitives for credential login lookup, actor membership
resolution, tenant-root initialization, individual closure-tree scope
creation, and role lookup by identifier/key. These are request or hierarchy
decisions rather than record loops in the current model. Revisit them when an
actual import/administration workflow requires repeated operations.

Bootstrap uses bulk permission granting. Delegated assignment uses a
set-based access decision for every capability granted by the target role
rather than a `for` loop issuing queries.

### Schema Constraints

Where feasible in Drizzle/PostgreSQL, tenant-sensitive relations should be
backed by composite foreign keys using the already declared unique tenant/id
pairs. This lets database constraints enforce tenant membership for writes and
reduces defensive per-item repository validation.

The migration must be additive and compatible with existing valid test data.
If Drizzle constraint expression limits prevent one of the desired composite
references, validation must still occur as one set query, never a loop.

## Data Flow

### Protected Batch Document Create

```text
createMany input
  -> validate all document JSON data
  -> collect unique requested auth scope IDs
  -> batch authorize collection:create for scopes
  -> batch insert documents
  -> return documents in input order
```

### Protected Batch Update

```text
updateMany input
  -> validate all document JSON data
  -> batch fetch existing documents
  -> validate not-found/version conflicts
  -> batch authorize unique existing target scopes
  -> transactional batch update
  -> return documents in input order
```

### Owner Bootstrap

```text
bootstrap input
  -> create foundational entities using batch primitives
  -> upsert all built-in permission definitions
  -> grant all matching permission keys to owner role in one set operation
  -> assign owner role through batch assignment
```

## Compatibility

- Public service method names and scalar return shapes remain available.
- Existing framework error codes remain stable.
- Trusted/internal calls without an actor remain supported.
- Remote adapters remain outside local database transactions and are still
  invoked only after authorization.
- The repository interfaces are internal framework contracts and may change to
  batch-shaped signatures in this refactor.

## Trade-Offs

- One-element batches apply to bulk-capable document and authorization paths,
  while justified singular auth setup/lookups avoid ceremonial collection
  wrappers.
- Composite foreign keys improve integrity and remove ad hoc checks, but
  require careful migration and Drizzle schema work.
- A set-based authorization API is slightly broader than scalar `checkAccess`,
  but it prevents future list/import/action workflows from rebuilding N+1
  permission checks.

## Rollback

- Keep service-facing behavior and tests stable while refactoring repository
  primitives incrementally.
- If a composite constraint proves incompatible with migration/tooling, retain
  a single-query validation implementation and defer only the constraint, not
  the batch boundary.
