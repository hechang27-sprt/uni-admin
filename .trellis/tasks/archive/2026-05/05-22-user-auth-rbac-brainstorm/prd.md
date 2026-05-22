# User Management Auth RBAC Brainstorm

## Goal

Design a simple, consistent foundation for user management, authentication,
permissions, and RBAC that fits the current Nuxt admin framework and its
tenant-scoped document data layer.

The planning outcome is a clear MVP scope and technical direction for projects
that need business logic involving hierarchical users, departments,
organizations, roles, and permission-scoped data access.

## User Value

- Framework users can add common admin authentication and authorization without
  rebuilding the same backend tables and guards per project.
- Project-specific business logic can ask one consistent authorization layer
  whether an actor may read, mutate, or run an action.
- Hierarchical permission cases, such as department-scoped users and managers,
  can be modeled without hard-coding every project into the framework core.
- The data layer remains tenant-safe while gaining room for user- and
  permission-aware access decisions.

## Confirmed Facts

- The original product intent in `docs/brainstorm.md` includes replacing the
  old Vue + Spring Boot template that had basic user management, RBAC, and
  permission systems.
- The data-layer MVP PRD intentionally deferred authentication, user
  management, RBAC, and permission UI unless needed to model data-layer
  ownership boundaries.
- The current implementation is a Nuxt 4 application/starter, not a published
  library or Nuxt module.
- The current storage model has `tenants` and tenant-scoped `documents`.
- All document service operations require explicit `tenantId`.
- Current collection records include document metadata and JSONB data, but no
  owner, actor, created-by, updated-by, role, permission, policy, session, or
  audit metadata.
- Current framework-facing document service methods accept tenant context but
  not an authenticated actor context.
- Current collection registration defines collection name, Zod data schema,
  schema version, and optional remote adapter; it has no permission policy
  declaration.
- Current remote adapters receive tenant context and collection, but not actor
  context.
- Current tests cover tenant isolation, validation, optimistic concurrency,
  query behavior, soft delete, and remote projection behavior.
- Operation records, queued actions, custom action registration, API routes,
  Nuxt composables, generated UI, and UI schema are not implemented yet.
- Dependencies do not currently include an authentication library.

## Requirements

- The design must fit the current tenant-scoped document data layer.
- The MVP API surface should be a core service-level TypeScript API, matching
  the current data-layer MVP style.
- The design must support future Nuxt API routes, composables, generated admin
  UI, custom server-side business actions, and custom Vue pages, but those
  surfaces are deferred.
- The design must keep tenant scoping explicit.
- The design must allow project-specific business logic to make authorization
  decisions consistently.
- The design must account for hierarchical permission management, such as
  organization, department, team, or resource-tree scopes.
- The MVP hierarchy model should use a generic tenant-scoped scope tree rather
  than a hard-coded department or organization table.
- Scope nodes should have framework-owned UUID identity, type, optional
  project-defined key/name metadata, and parent-child relationships.
- The MVP should represent scope ancestry with a closure table.
- A full nested-set tree implementation is out of scope for the MVP.
- Roles should be assignable to users at scopes so permission checks can apply
  through scope ancestry without requiring users themselves to belong to the
  scope tree.
- Users, credentials, tenant memberships, scope nodes, scope closure rows,
  roles, permissions, and role assignments must be stored in dedicated
  relational system tables.
- Project-specific user profile data, display preferences, or business metadata
  may be stored as normal documents when it is not required for core
  authorization enforcement.
- Permissions should be represented as stable capability strings, such as
  `tasks.read`, `tasks.update`, or `tasks.submit`.
- Permission definitions, role definitions, role-permission grants, and
  user-role assignments should be relational runtime data.
- Normal collection/action permission definitions should be derived from
  collection/action registration, not repeated in a separate explicit
  permission registry.
- Default capability strings should use a canonical framework naming scheme,
  for example `collection:<collection>:read` and
  `action:<collection>:<action>`.
- Collection CRUD operations and registered custom actions should derive their
  canonical permission strings by default without requiring explicit auth
  declarations per operation.
- Auth declarations should be needed only to override canonical capability
  names, opt out of generated permissions, alter resource-scope behavior, or
  configure non-default action behavior.
- Permission definition rows should be synced from collection/action
  registration so role grants reference known capabilities.
- Collection and action permission bindings should be code-defined as part of
  the application/framework contract.
- Code-defined policy bindings should declare which capability is required for
  each collection operation or custom action.
- Collection declarations should still allow capability overrides or explicit
  opt-out for trusted/internal-only operations.
- Role changes and user assignments should not require code deployment, but
  changing what a collection/action means for authorization should remain close
  to code.
- The recommended model is resource-scoped RBAC with a tenant-root default.
- Documents should support nullable framework-owned authorization scope
  metadata, tentatively `authScopeId`.
- Document authorization scope must be stored as a physical nullable
  `auth_scope_id` column on the `documents` table, not only inside JSONB data.
- `authScopeId = null` means the document is a tenant-root/global resource, not
  unscoped broad access.
- Document operations should resolve the target resource scope from
  `authScopeId`; `null` should resolve to the tenant root scope.
- A document operation should be allowed only when the actor has a scoped role
  assignment whose role grants the required capability and whose assignment
  scope contains the target resource scope.
- List operations should automatically constrain resource-scoped collections to
  documents whose target resource scope is contained by at least one matching
  actor role assignment scope.
- Collection/action declarations may provide an explicit
  `resourceScope: "none"` escape hatch only for operations that are genuinely
  capability-only and should not participate in resource containment.
- External relationship or policy engines such as OpenFGA, Cedar, or Cerbos are
  deferred until concrete applications require object-sharing, ABAC conditions,
  or cross-service policy administration.
- The design should separate authentication identity from authorization policy
  so projects can later swap the login/session mechanism without rewriting
  permission checks.
- User identity itself must be abstract and framework-owned, using generated
  UUID user IDs rather than provider-specific identifiers as the canonical
  identity.
- The starter MVP should include simple username + password authentication for
  end-to-end local use.
- Username + password authentication must be treated as one auth adapter, not
  as a hard dependency of the authorization core.
- Authorization checks should operate on a normalized actor context derived
  from the authenticated user identity.
- The MVP should prefer code-defined framework configuration, aligned with the
  current starter-template and code-defined collection schema approach.
- The MVP must identify what is in scope for backend enforcement versus later
  generated permission-management UI.
- The MVP should expose service APIs and bootstrap helpers for creating users,
  credentials, tenant root scopes, child scopes, roles, role grants, role
  assignments, actor resolution, and authorization checks.
- Auth/RBAC administration must be governed by the same authorization service,
  except for explicit bootstrap/trusted setup operations needed before the
  first actor exists.
- The framework should sync reserved built-in admin capabilities for user,
  credential, membership, role, grant, role-assignment, scope, tenant, and
  document-scope administration.
- Built-in admin capabilities should use a reserved naming scheme, for example
  `admin:users:create`, `admin:memberships:add`,
  `admin:role-assignments:assign`, `admin:scopes:create`, and
  `admin:documents:set-scope`.
- Tenant creation and first-owner setup should be trusted bootstrap operations
  in the service-level MVP, not ordinary actor-protected tenant-scoped
  operations.
- Tenant update/delete should either remain trusted-only in MVP or require
  tenant-root admin capabilities with explicit safeguards; accidental tenant
  deletion must not be available through generic CRUD semantics.
- Actor-protected admin operations should use resource-scoped containment:
  managing a child scope, role assignment, or document scope requires the actor
  to hold the relevant admin capability at the target scope or an ancestor.
- Role and grant administration must prevent privilege escalation. A delegated
  admin must not grant a role, permission, assignment, or scope authority that
  exceeds what they can administer unless they hold an explicit tenant-root
  owner/break-glass capability.
- The service must prevent removing or disabling the last effective tenant-root
  owner/admin assignment for a tenant.
- Normal document create operations should assign `authScopeId` from explicit
  framework metadata input, not from arbitrary JSONB document data.
- If document create omits `authScopeId`, it defaults to `null`, which resolves
  to tenant root/global resource.
- Normal update/patch operations must not change `authScopeId`.
- Changing an existing document's `authScopeId` should be a separate explicit
  scope reassignment operation guarded by a dedicated capability and checked
  against both the current and target scopes.
- Remote projections should be able to provide `authScopeId` as projection
  metadata; when omitted, a newly projected document defaults to tenant root
  and an existing projected document keeps its current authorization scope
  unless an explicit reassignment path is used.
- Server routes, client composables, generated user/role/scope management UI,
  and custom Vue page integrations are deferred.
- Field-level read/write authorization is deferred. The design should not block
  future code-defined field masks or write guards, but MVP enforcement is at
  document/action scope.
- Future UI generation may reduce the need for field-level restrictions by
  allowing sensitive data to live in separate collections and be composed
  through joined or multi-collection queries.

## Acceptance Criteria

- [x] PRD identifies the intended authentication boundary for MVP.
- [x] PRD identifies the core user, membership, role, permission, and hierarchy
      concepts the framework should model.
- [x] PRD defines how actor context should relate to existing tenant context in
      document and remote adapter operations.
- [x] PRD defines how collection/action permission policies should be declared.
- [x] Research note evaluates relevant RBAC, ReBAC, policy-engine, CMS, Nuxt,
      and PostgreSQL RLS patterns before choosing the recommended model.
- [x] PRD separates MVP backend enforcement from deferred permission-management
      UI.
- [x] PRD defines acceptance scenarios for tenant isolation, role checks,
      hierarchy-scoped access, and custom business actions.
- [x] Complex-task planning artifacts include `design.md` and `implement.md`
      before implementation starts.

## Acceptance Scenarios

- Tenant isolation: a user authenticated in tenant A cannot resolve actor
  context, role assignments, scopes, permissions, or documents from tenant B.
- Local login: a user created with a username/password credential can be
  authenticated into a normalized actor context containing user ID and tenant
  ID.
- Permission sync: collection/action registration produces known
  relational permission definitions with canonical names unless explicit
  overrides are provided.
- Tenant-root access: a role assigned at tenant root with
  `collection:tasks:read` can read documents whose `auth_scope_id` is `null`
  and documents in descendant scopes.
- Child-scope access: a role assigned at a department scope with
  `collection:tasks:update` can update a task whose `auth_scope_id` is that
  department or a descendant scope, but not a sibling department.
- List filtering: listing a resource-scoped collection returns only documents
  whose `auth_scope_id` is contained by at least one matching actor role
  assignment scope; `null` documents require matching tenant-root access.
- Denied mutation: update, patch, soft delete, restore, hard delete, remote
  update/delete, and custom actions fail before side effects when the actor
  lacks the required capability/scope containment.
- Remote-backed collection: remote-first writes receive actor context and do
  not call the remote adapter when authorization fails.
- Admin scope creation: an actor with `admin:scopes:create` at a department
  scope can create child scopes under that department, but not under a sibling
  or tenant root unless they also have authority there.
- Admin role assignment: a delegated admin can assign only roles/capabilities
  they are allowed to administer at the assignment target scope; attempts to
  assign broader roles or broader scopes are rejected.
- Last owner protection: removing the final effective tenant-root owner/admin
  assignment is rejected.
- Document create scope: creating a document with `authScopeId` requires create
  capability at that target scope; omitting `authScopeId` creates a tenant-root
  resource.
- Document scope reassignment: changing `authScopeId` requires the dedicated
  scope reassignment capability and authorization for both current and target
  scopes.
- Capability-only action: an explicitly declared `resourceScope: "none"` action
  checks only the actor's tenant-scoped capability and does not use document
  containment.
- Field-level access: field read/write masking is not enforced in MVP and is
  documented as deferred.

## Likely Out of Scope

- A polished generated UI for managing users, roles, and permission trees.
- OAuth/SAML/SSO provider integrations unless chosen as the MVP auth boundary.
- Full audit/event history beyond metadata required for authorization
  decisions.
- PostgreSQL row-level security as the first enforcement mechanism.
- A general external policy engine unless concrete requirements justify it.
- Storing core auth/RBAC enforcement data only in JSONB documents.
- Requiring users themselves to belong to the scope tree.
- Object-level relationship tuple storage for every document.
- Field-level authorization enforcement.

## Open Questions

- None for the current service-level auth/RBAC MVP.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- Research summary is in `research.md`.
