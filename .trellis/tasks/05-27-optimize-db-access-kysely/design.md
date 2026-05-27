# Design: Kysely-first SQL pushdown

## Boundaries

The change remains within server persistence and the minimum service contract
needed to eliminate database-result-driven access queries:

- `server/data/documents/repository/kysely.ts` owns ordered set-shaped
  document reads, writes, deletes, scope validation, and remote upsert result
  ordering.
- `server/auth/repository.ts` owns scope-tree persistence and any new
  set-oriented delegated role permission check.
- `server/auth/service.ts` may call that delegated permission repository
  operation instead of loading permission rows and expanding another access
  request in memory.
- Existing result/domain conversion (`mapDocumentRow`, auth row mappers),
  schema parsing, remote adapter mapping, and service authorization result
  alignment remain in TypeScript because they are non-SQL contract work.

No schema or public document contract change is planned.

## Query Shape

Use Kysely builders for statement composition, joins, predicates, inserts,
updates, and returning clauses. Use local `sql` fragments only where PostgreSQL
set input or the current batch update operation requires it:

- `unnest(...::uuid[]/text[]) with ordinality` creates ordered request input.
- JSON/document update tuple expansion may remain a typed raw fragment if
  Kysely cannot represent heterogeneous update fields without obscuring the
  query.
- Physical snake_case names appear only inside raw fragments, consistent with
  the camel-case plugin contract.

For ordered repository APIs, carry `inputOrder` through SQL and `orderBy` it
before returning. Result arrays still undergo domain/date conversion, but no
`Map`, `Set`, or `filter` will be used merely to correlate database rows back
to requested identifiers.

## Document Repository

### Ordered Read And Delete

- `findByIds`: create an ordered input relation from requested IDs, left join
  tenant/collection-scoped documents, apply soft-delete filtering in the join,
  and return one position per input ID. Missing joins become `null` in the API
  result without a result-row `Map`.
- `hardDeleteMany`: create ordered input, delete matching documents in a CTE,
  then select matching deleted IDs joined back to input order. This preserves
  duplicate requested IDs if the existing filter contract does so.

### Validated Writes

`insertMany`, `updateMany`, and `upsertRemoteProjections` currently issue a
scope-validation query before their mutation. Replace this two-call sequence
with statement-local input and invalid-scope CTEs:

- The invalid-scope relation selects the first non-null input scope absent
  from the tenant scope table in request order.
- Mutation CTEs execute only when the invalid-scope relation is empty.
- Successful mutations validate and write in one statement. A rejected
  mutation may run an ordered validation lookup only to preserve precise
  `INVALID_AUTH_SCOPE` details.
- `updateMany` also preserves atomic stale-version semantics by returning
  `null` when mutation count differs from input count.
- Projection upsert joins returned rows to ordered remote input rather than
  reconstructing a result `Map`.

This changes the shared auth-scope validation boundary and must receive focused
cross-tenant coverage before completion.

## Auth Repository And Service

- `createScope`: insert the child scope and closure rows from parent closure
  data in one transactional, Kysely-composed CTE statement, rather than
  reading ancestor rows into TypeScript and inserting mapped values. A missing
  parent must still produce `AUTH_SCOPE_NOT_FOUND`.
- Evaluate `ensureTenantRootScope` for the same CTE pattern only if it can
  preserve conflict/concurrency semantics with a clearer statement than the
  existing transactional implementation; do not force this refactor.
- Introduce a repository-level delegated-role authorization query only if it
  replaces the `rolePermissionKeys` -> `checkAccessMany` sequence in
  `assignRoleAsActor` with one SQL check and preserves the first denied
  capability in the thrown error. The only result-expanding caller is replaced
  by `findDeniedRolePermission`.

The user's existing changes to `grantPermissions`, `assignRoles`, and
`checkAccessMany` are reference implementations and will not be rewritten
unless a correctness defect blocks tests.

## Compatibility And Risks

- Returned ordering and positional `null` entries are API behavior, not
  optimization opportunities; SQL must maintain them.
- Mapping database timestamps to `Date` remains mandatory because raw pgLite
  execution can return strings.
- Data-modifying CTE behavior must be verified under pgLite as well as typed by
  Kysely.
- Consolidating validation and mutation reduces round trips but broadens the
  effect of any query mistake across all document write paths. GitNexus marks
  the current shared validation helper as `HIGH` risk.
- Existing dirty changes in auth and database logging will be preserved.

## Rollback

Each query consolidation can be reverted independently to the pre-change
repository method while retaining tests. If validated write consolidation
proves incompatible with pgLite or excessively opaque in Kysely, retain the
ordered read/delete and auth-scope insertion improvements and leave
validation/mutation as two calls with the risk recorded.
