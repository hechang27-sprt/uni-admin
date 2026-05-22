# Auth/RBAC

## Scenario: Service-Level User Auth And Resource-Scoped RBAC

### 1. Scope / Trigger

- Trigger: server work adds or changes authentication, tenant memberships,
  permission definitions, role grants, scope hierarchy, actor resolution, or
  actor-scoped document operations.
- Keep the MVP backend-only. Do not add routes, composables, or generated UI
  unless a task explicitly asks for those layers.

### 2. Signatures

- Public auth surface: `server/auth/index.ts`.
- Repository: `new DrizzleAuthRbacRepository(db)`.
- Service class: `new AuthRbacService({ repository })`.
- Document integration:

```ts
new DocumentService({
  registry,
  repository: new DrizzleDocumentRepository(db),
  authorizer: authRbacService,
});
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

### 3. Contracts

- Database tables use explicit primary key names: `user_id`, `scope_id`,
  `role_id`, `permission_id`.
- `documents.auth_scope_id` is framework metadata. It is not stored in document
  JSONB data.
- `authScopeId: null` means tenant-root/global resource, not public access.
- Collection CRUD capabilities default to
  `collection:<collection>:<operation>`.
- Registered action capabilities default to `action:<collection>:<action>`.
- `resourceScope: "document"` checks the document `auth_scope_id`; `null`
  normalizes to the tenant root scope.
- `resourceScope: "none"` checks only tenant-root capability and skips document
  containment.
- Protected remote writes must authorize before calling a remote adapter.
  Adapter context receives `actor` only on protected calls.

### 4. Validation & Error Matrix

- Unknown collection -> `DocumentServiceError` code `UNKNOWN_COLLECTION`.
- Document method called with service options containing `actor` and protected
  collection auth but without `authorizer` ->
  `AUTHORIZER_REQUIRED`.
- Actor-required service operation called without `actor` in its service
  options -> `AUTHORIZATION_DENIED`.
- Missing capability or failed scope containment -> `AUTHORIZATION_DENIED`.
- Cross-tenant `authScopeId` in trusted document writes ->
  `INVALID_AUTH_SCOPE`.
- Missing or inactive tenant membership during actor resolution ->
  `AuthRbacError` code `AUTH_TENANT_MEMBERSHIP_REQUIRED`.
- Missing role/scope/permission during RBAC setup -> `AUTH_ROLE_NOT_FOUND`,
  `AUTH_SCOPE_NOT_FOUND`, or `AUTH_PERMISSION_NOT_FOUND`.

### 5. Good/Base/Bad Cases

- Good: create a tenant root scope, assign a role at that scope, and verify the
  actor can access `auth_scope_id = null` documents plus descendant scopes.
- Good: assign a role at a child scope and verify sibling documents are absent
  from `list(input, { actor })`.
- Base: call trusted `create` from seed/import code when no actor exists.
- Bad: change `authScopeId` through JSON Patch or data update. Use
  `setDocumentAuthScope`.
- Bad: pass a scope from tenant B into a tenant A document write.

### 6. Tests Required

- pgLite migration test coverage through `migrate(db, { migrationsFolder })`.
- Username/password verification and actor resolution.
- Tenant isolation for memberships, scopes, role assignments, and documents.
- List filtering with child-scope and tenant-root/null documents.
- Authorized mutation allow/deny behavior.
- Remote write denial before adapter side effects.
- Trusted write rejection for cross-tenant `authScopeId`.

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
