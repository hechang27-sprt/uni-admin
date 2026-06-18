# Auth/RBAC

## Scenario: Service-Level User Auth And Resource-Scoped RBAC

### 1. Scope / Trigger

- Trigger: server work adds or changes authentication, tenant memberships,
  permission definitions, role grants, scope hierarchy, actor resolution, or
  actor-scoped document operations.
- Keep the MVP backend-only. Do not add routes, composables, or generated UI
  unless a task explicitly asks for those layers.

### 2. Signatures

- Public user-management auth surface: `server/auth/um/index.ts`. Reserve sibling
  modules under `server/auth/` for distinct auth areas such as future
  `server/auth/session/` work.
- Repository implementation: `KyselyAuthRbacRepository`.
- Service class: `AuthRbacService`.
- DI integration uses `createServerContainer` and `SERVER_DI_TYPES` from
  `server/di`. Interface-typed dependencies must bind/inject by symbol because
  TypeScript interfaces are erased at runtime.
- Document integration:

```ts
const container = createServerContainer({
  database: db,
  registry,
});
const auth = container.get<AuthRbacService>(SERVER_DI_TYPES.AuthRbacService);
const service = container.get<DocumentService>(SERVER_DI_TYPES.DocumentService);
```

- Document authorization boundary:

```ts
interface AuthRbacRepository {
  grantPermissions(input: {
    tenantId: string;
    roleId: string;
    permissionKeys: string[];
  }): Promise<void>;
  assignRoles(input: {
    tenantId: string;
    assignments: { userId: string; roleId: string; scopeId: string | null }[];
  }): Promise<void>;
  findDeniedRolePermission(input: {
    tenantId: string;
    roleId: string;
    userId: string;
    targetScopeId: string;
  }): Promise<string | null>;
  findActiveTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<TenantMembership | null>;
  findInvalidActiveMembershipUserId(input: {
    tenantId: string;
    userIds: string[];
  }): Promise<string | null>;
  findInvalidRoleId(input: {
    tenantId: string;
    roleIds: string[];
  }): Promise<string | null>;
  findInvalidAssignmentId(input: {
    tenantId: string;
    assignmentIds: string[];
  }): Promise<string | null>;
  findInvalidScopeId(input: {
    tenantId: string;
    scopeIds: string[];
  }): Promise<string | null>;
  findInvalidDocumentId(input: {
    tenantId: string;
    documentIds: string[];
  }): Promise<string | null>;
  findInvalidPermissionKey(input: {
    permissionKeys: string[];
  }): Promise<string | null>;
  checkCapabilities(input: {
    tenantId: string;
    userId: string;
    checks: { capability: string; targetScopeId: string | null }[];
  }): Promise<boolean[]>;
}
```

- Actor context:

```ts
interface TenantActorContext {
  tenantId: string;
  actor: { userId: string };
}
```

- Existing document methods accept an optional `DocumentServiceOptions` second
  argument, for example `service.update(input, { actor })`. Omitting the
  argument, or passing options without `actor`, keeps the call
  trusted/internal. Passing options with `actor` runs RBAC checks before
  protected reads, writes, and remote adapter side effects.
- `setDocumentAuthScope` and `listCreatableScopes` require service options
  with `actor` because they are explicitly authorization-scoped management
  operations.

- Database tables use explicit primary key names for identity tables such as
  `user_id`, `scope_id`, and `role_id`. `permissions` is keyed by canonical
  `key`; there is no separate `permission_id`.
- Permission rows carry `app_id`, `collection_id`, `capability_id`, `source`,
  and optional `resource_scope`; `source` denotes structured permission
  location (`collection`, `app`, `global`, or `admin`), while custom action
  identity lives in `capability_id` as `action-<action-id>`.
- `role_permissions.permission_key` references `permissions.key`.
- `SYSTEM_TENANT_ID` and `BOTTOM_SCOPE_ID` are both the all-zero UUID
  `00000000-0000-0000-0000-000000000000`. The system tenant owns the physical
  bottom scope row.
- `user_role_assignments.scope_id` is non-nullable. Explicit bottom-scope grants
  for `resourceScope: "none"` store `BOTTOM_SCOPE_ID`, not `null`.
- `documents.auth_scope_id` is framework metadata. It is not stored in document
  JSONB data.
- Omitted document `authScopeId` normalizes to the real tenant-root scope UUID.
  Bottom-scoped documents store `BOTTOM_SCOPE_ID` explicitly.
- Built-in collection CRUD capabilities are fixed ids: `read`, `create`,
  `update`, `patch`, `delete`, `restore`, and `hard-delete`.
- Registered custom action capabilities default to `action-<action-id>`.
- Canonical permission keys are:
  - `admin:<capability-id>` for special admin permissions.
  - `global:<capability-id>` for special global framework permissions.
  - `<app-id>:<capability-id>` for app-level permissions.
  - `<app-id>:<collection-id>:<capability-id>` for collection-level
    permissions.
- `resourceScope: "document"` checks the document `auth_scope_id` directly.
- `resourceScope: "tenant-root"` still resolves through the real tenant-root
  scope id and skips document containment.
- `resourceScope: "none"` targets `BOTTOM_SCOPE_ID`. Concrete scoped grants and
  explicit bottom grants may satisfy it, but bottom grants must not satisfy
  document or tenant-root checks.
- Repository/service evaluator input no longer uses nullable bottom sentinels.
  `targetScopeIds` always carry concrete UUIDs; callers that need tenant-root
  authorization pass the real root scope id, and bottom-target callers pass
  `BOTTOM_SCOPE_ID`.
- Document service now normalizes create/write auth scope ids before
  persistence, passes direct grant rows into list filtering, and uses the
  repository/query layer to translate `document`, `tenant-root`, and `none`
  resource-scope reads.
- Protected remote writes must authorize before calling a remote adapter.
  Adapter context receives `actor` only on protected calls.
- Scalar public service APIs such as `grantPermission`, `assignRole`, and
  `checkAccess` wrap one-element repository batches. Login, actor membership
  lookup, root-scope creation, scope-tree creation, and role resolution remain
  justified singular operations.
- `AuthRbacService.evaluateAccess` owns omnibus orchestration for active
  membership, tenant-bound id validity, permission-key validity, and capability
  authorization. Repository helpers report database facts; they do not expose a
  service-policy omnibus method.
- Service-level omnibus input may include `tenantAccess.userId` for validating
  target memberships and `permissionKeys` for list-access APIs that need
  canonical permission-key validation without requiring access to a single
  target scope.
- Auth service list-access APIs validate active actor membership and canonical
  permission-key existence through the same service-owned omnibus evaluator
  before asking repository list queries for accessible scopes.
- Repository validation helpers report the first ordered failure needed to
  choose the service error, not every invalid id or denied capability. Preserve
  caller order inside each input set when selecting that failure.
- Tenant-owner bootstrap grants all built-in permissions with one
  `grantPermissions` call. Delegated assignment checks all target-role
  capabilities inside one `findDeniedRolePermission` query after admin/owner
  checks, returning only the first capability the actor lacks.
- Child auth-scope creation inserts the new scope and its closure rows from
  parent closure data in one statement; do not read ancestor rows into
  TypeScript for a mapped follow-up insert.
- `syncCollectionPermissions(registry)` derives collection permissions from the
  registry and persists canonical keys after catalog app/collection identity is
  synced. Built-in CRUD capability ids cannot be overridden by collection auth
  config; custom capabilities are emitted only for registered action callback
  keys, and `auth.actions` cannot name callbacks missing from `actions`.

### 4. Validation & Error Matrix

- Unknown collection -> `DocumentServiceError` code `UNKNOWN_COLLECTION`.
- Actor-required service operation called without `actor` in its service
  options -> `AUTHORIZATION_DENIED`.
- Missing capability or failed scope containment -> `AUTHORIZATION_DENIED`.
- Cross-tenant `authScopeId` in trusted document writes ->
  `INVALID_AUTH_SCOPE`; document service performs this validation through the
  configured `AuthRbacService.evaluateAccess` before repository writes.
- Missing or inactive tenant membership during actor resolution ->
  `AuthRbacError` code `AUTH_TENANT_MEMBERSHIP_REQUIRED`.
- Missing role/scope/permission during RBAC setup -> `AUTH_ROLE_NOT_FOUND`,
  `AUTH_SCOPE_NOT_FOUND`, or `AUTH_PERMISSION_NOT_FOUND` for the unknown
  canonical permission key.
- Any failed check in a protected document mutation batch ->
  `DocumentServiceError` code `AUTHORIZATION_DENIED`; protected `list` reads
  omit denied documents from `items`.

### 5. Good/Base/Bad Cases

- Good: create a tenant root scope, assign a role at that scope, and verify the
  actor can access `auth_scope_id = null` documents plus descendant scopes.
- Good: assign a role at a child scope and verify sibling documents are absent
  from `list(input, { actor })`.
- Good: register two apps with a collection named `tasks`; grant only the
  canonical key for one app/collection and verify the other app is denied.
- Good: authorize a multi-document update by sending its distinct scope checks
  once and preserve document input order.
- Base: call trusted `create` from seed/import code when no actor exists.
- Bad: change `authScopeId` through JSON Patch or data update. Use
  `setDocumentAuthScope`.
- Bad: pass a scope from tenant B into a tenant A document write.
- Bad: iterate role permission keys and execute one access query for each
  permission during delegated administration.

### 6. Tests Required

- pgLite migration test coverage through `migrateToLatest(db)`.
- Username/password verification and actor resolution.
- Tenant isolation for memberships, scopes, role assignments, and documents.
- List filtering with child-scope documents, explicit tenant-root documents,
  and explicit bottom-scope documents/grants.
- Authorized mutation allow/deny behavior, including tenant-root using the real
  root scope id, `resourceScope: "none"` using `BOTTOM_SCOPE_ID`, and the
  direct-grant list path for protected reads.
- Remote write denial before adapter side effects.
- Trusted write rejection for cross-tenant `authScopeId`.
- Protected batch create/read/update allow and deny paths with one
  `evaluateAccess` batch call per logical operation.
- Owner bootstrap bulk grant behavior and delegated role denial/allow behavior
  through `findDeniedRolePermission`.
- Permission sync and grant/evaluation coverage for built-in admin/global keys,
  app-scoped keys, collection-scoped keys, duplicate human collection keys across
  apps, unknown canonical key failure, and persisted `resource_scope` metadata.

### 7. Wrong vs Correct

#### Wrong

```ts
await service.update({
  tenantId,
  collection: "tasks",
  id,
  expectedVersion,
  data: { ...task, authScopeId: departmentScopeId },
});
```

#### Correct

```ts
await service.setDocumentAuthScope(
  {
    tenantId,
    collection: "tasks",
    id,
    expectedVersion,
    authScopeId: departmentScopeId,
  },
  {
    actor: { userId },
  },
);
```

The correct path treats authorization scope as framework metadata and checks
`admin:documents:set-scope` against both the current and target scopes.

#### Wrong

```ts
const capabilities = await repository.rolePermissionKeys({ tenantId, roleId });
await repository.checkCapabilities({
  tenantId,
  userId,
  checks: capabilities.map((capability) => ({ capability, targetScopeId })),
});
```

#### Correct

```ts
const deniedCapability = await repository.findDeniedRolePermission({
  tenantId,
  roleId,
  userId,
  targetScopeId,
});
```
