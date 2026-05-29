# Design: Omnibus Auth Access Checks

## Architecture And Boundaries

`AuthRbacService.checkAccessMany` becomes the orchestration boundary for actor
authorization. The service decides which memberships, tenant ids, permission
keys, and capabilities must be checked for a call path. The repository remains
the database fact provider and persistence layer.

Repository helpers should be named for what they query, not for service policy.
Likely helpers:

- `findActiveTenantMembership({ tenantId, userId })`
- `findInvalidActiveMembershipUserId(...)`
- `findInvalidRoleId(...)`
- `findInvalidAssignmentId(...)`
- `findInvalidScopeId(...)`
- `findInvalidDocumentId(...)`
- `findInvalidPermissionKey(...)`
- `checkCapabilities(...)`
- `findDeniedRolePermission(...)` or a more general delegated-role helper

The repository may keep validation inside mutation methods such as
`grantPermissions` and `assignRoles` where direct repository safety matters.
Service-level actor flows should not depend on those methods for authorization
decisions.

## Contracts

Service-level omnibus input should support current document authorizer checks
and auth-management checks:

```ts
interface CheckAccessManyInput {
  context: TenantActorContext;
  tenantAccess?: {
    userId?: string[];
    roleId?: string[];
    assignmentId?: string[];
    scopeId?: string[];
    documentId?: string[];
  };
  permissionKeys?: string[];
  capabilities?: {
    permissionKey: string;
    targetScopeId: string | null;
  }[];
}
```

For document authorization compatibility, either keep a `checks` alias during
migration or update call sites/tests to the `capabilities` field in one pass.

The service result should preserve both boolean batch semantics and first
failure details. Internally, failure details should be rich enough to choose:

- `AUTH_TENANT_MEMBERSHIP_REQUIRED`
- `AUTH_ROLE_NOT_FOUND`
- `AUTH_SCOPE_NOT_FOUND`
- `AUTH_PERMISSION_NOT_FOUND`
- `AUTH_PERMISSION_DENIED`
- `DocumentServiceError("AUTHORIZATION_DENIED")`

Document authorizer compatibility may continue to expose boolean arrays if the
document service only needs allow/deny per scope. If the shared interface is
changed to the richer result, document service must map it back to positional
read/mutation behavior.

For trusted document writes without an actor, `DocumentService` still validates
non-null `authScopeId` values before repository persistence. That validation
uses a service-level `DocumentAuthorizer.validateTenantAccess(...)` database
fact check rather than a document repository guard.

## Data Flow

1. Service receives actor context and the requested tenant/id/capability set.
2. Service checks active membership first.
3. Service queries independent tenant id and permission-key validations in
   parallel through repository helpers.
4. Service maps the first ordered invalid value to the appropriate auth error.
5. Service asks the repository capability helper for authorization results.
6. Service maps the first denied capability to auth/document errors while
   preserving document batch positional behavior.

## Compatibility Notes

- Existing trusted document writes without actor options remain trusted, but
  invalid auth scopes are still rejected.
- Existing tests that spy on `repository.checkAccessMany` need to target the
  new helper or the service method, depending on what behavior they assert.
- `checkCapabilities` should retain `boolean[]` positional semantics for
  document batch authorization and scalar wrappers.

## Trade-Offs

- More service code, less repository policy: this makes authorization intent
  easier to review at call sites and keeps repository methods reusable.
- Separate queries instead of one giant SQL statement: simpler and more
  maintainable, while independent validations can still run in parallel.
- Rich result vs exceptions: service-level rich results make document reads
  able to return `null` for denied rows; service methods that must reject can
  throw after inspecting the failure.

## Rollback

The rollback point is the service/repository boundary. If integration becomes
too invasive, keep `checkCapabilities` and existing document authorizer calls,
and only migrate auth-management paths first.
