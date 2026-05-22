# User Management Auth RBAC Design

## Architecture

The MVP adds a service-level authorization subsystem beside the existing
document data layer. It does not add server routes, client composables, or UI.

Primary modules:

- `auth` service: user identity, username/password credential authentication,
  and normalized actor resolution.
- `rbac` service: tenant root scope, child scopes, closure table maintenance,
  roles, permissions, grants, role assignments, and access checks.
- document service integration: accepts actor-aware inputs for protected
  operations and applies authorization before repository writes or remote
  adapter calls.
- collection/action auth registry: derives capability names from code-defined
  collection/action declarations and syncs them into relational permission
  definitions.

The authorization core is independent of the starter username/password
credential adapter. Canonical user identity is a generated UUID.

## Data Model

System tables are relational.

Auth/RBAC tables should use explicit primary key column names, not a generic
`id`. Examples: `user_id`, `scope_id`, `role_id`, and `permission_id`.

Suggested tables:

- `users`
  - `user_id uuid primary key`
  - `display_name text null`
  - timestamps/status fields as needed
- `user_password_credentials`
  - `user_id uuid references users`
  - `username text unique not null`
  - `password_hash text not null`
  - timestamps/status fields as needed
- `tenant_memberships`
  - `tenant_id uuid references tenants`
  - `user_id uuid references users`
  - status/timestamps
  - unique `(tenant_id, user_id)`
- `auth_scopes`
  - `scope_id uuid primary key`
  - `tenant_id uuid references tenants`
  - `parent_id uuid null references auth_scopes`
  - `type text not null`
  - `key text null`
  - `name text null`
  - timestamps/status fields as needed
  - unique tenant-level key constraints where useful
- `auth_scope_closure`
  - `tenant_id uuid references tenants`
  - `ancestor_id uuid references auth_scopes`
  - `descendant_id uuid references auth_scopes`
  - `depth integer not null`
  - primary key `(tenant_id, ancestor_id, descendant_id)`
- `roles`
  - `role_id uuid primary key`
  - `tenant_id uuid references tenants`
  - `key text not null`
  - `name text null`
  - unique `(tenant_id, key)`
- `permissions`
  - `permission_id uuid primary key`
  - `key text not null`
  - `source text not null`
  - optional description/metadata
  - unique `key`
- `role_permissions`
  - `tenant_id uuid references tenants`
  - `role_id uuid references roles`
  - `permission_id uuid references permissions`
  - unique `(role_id, permission_id)`
- `user_role_assignments`
  - `tenant_id uuid references tenants`
  - `user_id uuid references users`
  - `role_id uuid references roles`
  - `scope_id uuid references auth_scopes`
  - unique `(tenant_id, user_id, role_id, scope_id)`

The existing `documents` table gains:

- `auth_scope_id uuid null references auth_scopes`

`auth_scope_id = null` means tenant-root/global resource. It does not mean
unscoped public access.

Database constraints should make cross-tenant mistakes hard:

- `auth_scopes` should expose a unique `(tenant_id, scope_id)` pair for
  composite references.
- `documents(tenant_id, auth_scope_id)` should reference
  `auth_scopes(tenant_id, scope_id)` when `auth_scope_id` is not null, or the
  service must enforce the equivalent invariant if the chosen Drizzle/Postgres
  shape is awkward.
- closure rows should require ancestor and descendant scopes to belong to the
  same tenant.
- role grants and role assignments should enforce that role, assignment scope,
  and tenant all match.

Suggested document indexes:

- `(tenant_id, collection, auth_scope_id)`
- `(tenant_id, auth_scope_id)`

## Scope Semantics

Every tenant has one tenant-root scope. Scope ancestry is maintained in the
closure table. A role assignment at scope `S` applies to a document/action
target scope `T` when closure contains `S -> T`.

For documents:

- `auth_scope_id = null` normalizes to tenant root for checks.
- `auth_scope_id = scope_uuid` uses that scope as the target resource scope.

Users do not need to belong to scope nodes. Their authority is represented by
role assignments at scope nodes.

## Capabilities

Collection/action registration is the normal source of permission definitions.

Default capability names:

- collection operation: `collection:<collection>:<operation>`
- action operation: `action:<collection>:<action>`

Declarations may override the capability string when a project needs shared or
legacy names.

The framework should provide a permission sync/bootstrap API that upserts
permission definitions derived from registered collections and actions before
roles grant them. Roles, grants, assignments, users, and scopes are runtime
relational data.

Reserved framework admin capabilities are synced by the RBAC service itself,
not derived from collections. Initial set:

- `admin:tenant:owner`
- `admin:users:create`
- `admin:users:update`
- `admin:users:disable`
- `admin:credentials:set-password`
- `admin:memberships:add`
- `admin:memberships:remove`
- `admin:roles:create`
- `admin:roles:update`
- `admin:roles:delete`
- `admin:role-permissions:grant`
- `admin:role-permissions:revoke`
- `admin:role-assignments:assign`
- `admin:role-assignments:revoke`
- `admin:scopes:create`
- `admin:scopes:update`
- `admin:scopes:delete`
- `admin:documents:set-scope`
- `admin:tenant:update`
- `admin:tenant:delete`

Tenant creation and first-owner setup are trusted bootstrap operations in the
MVP because no tenant-root scope or actor exists yet.

Username/password credentials should use a dedicated password hashing library.
Prefer Argon2id with tunable memory/time/parallelism parameters. If Argon2id is
not practical in the runtime, use a documented fallback such as bcrypt or
PBKDF2 with explicit parameters; never store reversible or plaintext
passwords. Store algorithm/parameter metadata with the hash so credentials can
be upgraded later.

## Service Contracts

Normalized context:

```ts
interface TenantActorContext {
  tenantId: string;
  actor: {
    userId: string;
  };
}
```

The auth service should support:

- create user
- create/set username password credential
- verify username/password credential
- resolve actor context for a tenant
- create tenant membership

The RBAC service should support:

- ensure tenant root scope
- create child scope
- list/get scopes
- create role
- sync permissions from collection/action declarations
- grant permission to role
- assign role to user at scope
- check access for `(tenantId, userId, capability, targetScopeId | null)`
- return accessible scope IDs for `(tenantId, userId, capability)`
- protected admin operations that check admin capabilities before mutating
  users, credentials, memberships, roles, grants, assignments, scopes, or
  document scope metadata

The document service integration should support actor-aware protected
operations. Authorization runs before mutation, hard delete, custom action, or
remote side effect.

## Collection Auth Declarations

Candidate shape:

```ts
defineAdminCollection({
  name: "tasks",
  schema: taskSchema,
  schemaVersion: 1,
  auth: {
    hardDelete: "collection:tasks:hard-delete",
    resourceScope: "document",
    actions: {
      submit: {},
      export: {
        capability: "tasks.export",
        resourceScope: "none",
      },
    },
  },
});
```

Collection CRUD operations derive canonical capabilities by default, for
example `collection:tasks:read`, `collection:tasks:create`,
`collection:tasks:update`, `collection:tasks:patch`, and
`collection:tasks:delete`. Registered custom actions derive canonical
capabilities by default, for example `action:tasks:submit`. Auth declarations
are only needed for capability overrides, opt-outs, resource-scope settings, or
non-default action behavior.

A string uses an explicit capability override.
`resourceScope: "document"` means use document `auth_scope_id`, with null
normalized to tenant root. `resourceScope: "none"` is an explicit escape hatch
for capability-only operations.

Create operations need an input `authScopeId?: string | null`; when omitted, it
defaults to null/tenant root.

## Admin Governance

There are two API classes:

- trusted bootstrap APIs for installation, tests, seed scripts, and first-owner
  setup
- actor-protected admin APIs for normal runtime administration

Trusted APIs must be visibly separate from protected APIs. They should either
live on a separate bootstrap service or require an explicit `trusted: true`
style option that cannot be supplied accidentally through user-facing code.

Trusted bootstrap APIs may create the first tenant, tenant-root scope, first
user, password credential, owner role, built-in permission grants, and owner
role assignment. They should be idempotent where practical and clearly named so
application code does not confuse them with user-facing admin operations.

Actor-protected admin APIs use the same resource-scoped RBAC checker:

- creating a child scope under parent `P` requires `admin:scopes:create` at
  `P` or an ancestor
- updating or deleting scope `S` requires the matching scope admin capability
  at `S` or an ancestor
- assigning role `R` to user `U` at scope `S` requires
  `admin:role-assignments:assign` at `S` or an ancestor
- revoking an assignment at scope `S` requires
  `admin:role-assignments:revoke` at `S` or an ancestor
- granting or revoking permissions on a tenant role requires the relevant role
  permission admin capability at tenant root unless a narrower role-governance
  model is introduced later
- adding/removing tenant memberships requires membership admin capability at
  tenant root
- tenant update/delete are not generic document operations; MVP should keep
  tenant creation trusted-only and require tenant-root admin capability plus
  explicit confirmation for tenant update/delete if those methods are exposed
- capability-only operations with `resourceScope: "none"` still require the
  capability at tenant root; they only skip document/resource containment

Delegated admin operations must prevent privilege escalation:

- a delegated admin cannot assign a role at a scope they cannot administer
- a delegated admin cannot grant a permission they do not hold at tenant root
  or are not explicitly allowed to administer
- a delegated admin cannot create a role/grant/assignment combination that
  would give another user broader authority than the admin can grant
- an owner/break-glass role assigned at tenant root may bypass subset checks
  through the explicit `admin:tenant:owner` reserved capability

The service must protect tenant operability:

- reject removal or disabling of the last effective tenant-root owner/admin
  assignment
- reject deletion of non-empty scopes in MVP
- reject scope deletion when child scopes, role assignments, or documents still
  reference the scope or descendants
- keep scope reparenting out of MVP unless closure-table maintenance and access
  implications are explicitly designed

## Document Scope Assignment

`auth_scope_id` is framework metadata, not application JSONB data.

Practical assignment patterns:

- Tenant-global records omit `authScopeId`. Examples: global announcement,
  tenant settings, shared lookup list. They are stored with `auth_scope_id =
  null` and require tenant-root access for protected operations.
- Department/team-owned records receive `authScopeId` from an explicit UI or
  service input. Examples: task belongs to Department A, inspection target
  belongs to Region East, campaign belongs to Team Growth.
- Child records usually inherit scope from their parent record unless the
  collection declaration overrides that behavior. Example: task comment,
  attachment, or approval record inherits the parent task's `authScopeId`.
- Workflow/action-created documents receive scope from the action context.
  Example: a `submitTask` action creates an approval request with the same
  `authScopeId` as the submitted task.
- Remote-backed projections may map remote department/organization identity to
  a local scope and return that as projection metadata. If the adapter cannot
  map a remote scope, a new projection defaults to tenant root unless the
  collection requires explicit scope.
- Migration/import scripts may use trusted or admin-guarded bulk APIs to set
  `authScopeId` explicitly from legacy department/org columns.

Create:

- local create accepts `authScopeId?: string | null` as top-level service
  input
- omitted `authScopeId` stores `null` and checks against tenant root
- provided `authScopeId` must belong to the same tenant
- actor-protected create requires the derived create capability at the target
  scope
- service-level code should not infer `authScopeId` from the actor's role
  assignments because an actor may have access to multiple scopes; generated UI
  or application code may choose a default scope for convenience but must pass
  it explicitly
- the service should expose a helper such as `listCreatableScopes` for
  `(tenantId, userId, collection)` so generated UI and custom pages can show
  only valid `authScopeId` choices

Update/patch:

- normal data update and JSON Patch cannot modify `auth_scope_id`
- JSON Patch paths target document `data`, not framework metadata
- attempts to include `authScopeId` inside data do not affect authorization
  metadata

Reassignment:

- changing `auth_scope_id` uses an explicit `setDocumentAuthScope` style API
- the API requires a dedicated capability, for example
  `admin:documents:set-scope` or an overridden collection-specific capability
- the actor must be authorized for both the current target scope and the new
  target scope to prevent moving documents out of or into unauthorized areas
- `null` target is tenant root

Remote projections:

- remote projection mappers may return `authScopeId` as metadata alongside
  `remoteId` and `data`
- a new remote projection without `authScopeId` defaults to tenant root
- an existing remote projection without `authScopeId` keeps its current scope
  unless the remote adapter explicitly returns a new scope and the enclosing
  sync/write path is authorized to reassign it
- remote write authorization happens before remote side effects

Creation follows the same pattern used by resource-oriented authorization
systems: authorize against the parent/container scope before the new resource
exists, then persist the new resource with that target scope.

## Enforcement Flow

Get/update/delete by ID:

1. Load document by tenant/collection/id.
2. Resolve required capability from collection operation declaration.
3. Normalize target scope from `document.authScopeId`.
4. Check role assignment containment and capability grant.
5. Continue existing validation, version, and repository logic.

List:

1. Resolve required read capability.
2. Fetch accessible assignment scopes for the actor/capability.
3. Convert accessible scopes to descendant target scopes through closure.
4. Add a repository filter for matching `auth_scope_id`.
5. Include `auth_scope_id is null` only when tenant-root scope is accessible.

Create:

1. Resolve requested `authScopeId` from input or default null.
2. Normalize null to tenant root for the check.
3. Check create capability against target scope.
4. Persist document with physical `auth_scope_id`.

Remote write/action:

1. Resolve target document/scope when document-scoped.
2. Check capability and containment.
3. Only then call remote adapter or action `run`.
4. Projection writes keep the same actor/tenant context.

## Out Of Scope

- Server routes and Nuxt composables.
- Generated user/role/scope management UI.
- Field-level read/write authorization.
- External policy engine integration.
- PostgreSQL RLS as first enforcement layer.
- Relationship tuple storage per document.
- Users belonging directly to scope nodes for authorization.

## Tradeoffs

Physical `auth_scope_id` adds schema surface to the document table but gives
the framework reliable, indexable enforcement. Nullable tenant-root semantics
avoid forcing every document into a hierarchy while keeping the containment rule
consistent.

Resource-scoped RBAC is less flexible than ReBAC or a policy language, but it
fits internal admin tools where most authorization follows tenant,
department/team, and action capability boundaries.
