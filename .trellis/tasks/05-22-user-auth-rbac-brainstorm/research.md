# Auth/RBAC Design Research

## Sources Reviewed

- NIST RBAC FAQ:
  https://csrc.nist.gov/Projects/role-based-access-control/faqs
- Apache Casbin RBAC with domains:
  https://casbin.apache.org/docs/rbac-with-domains/
- OpenFGA modeling guide:
  https://openfga.dev/docs/modeling/getting-started
- Cedar entity and hierarchy docs:
  https://docs.cedarpolicy.com/policies/syntax-entity.html
- Cerbos resource policy docs:
  https://docs.cerbos.dev/cerbos/latest/policies/resource_policies.html
- PostgreSQL row security docs:
  https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- Payload access control docs:
  https://payloadcms.com/docs/access-control/overview
- Directus roles and access control docs:
  https://directus.io/docs/api/roles
  https://directus.io/docs/guides/auth/access-control
- Nuxt sessions and authentication recipe:
  https://nuxt.com/docs/4.x/guide/recipes/sessions-and-authentication
- Keycloak Authorization Services:
  https://www.keycloak.org/docs/latest/authorization_services/
- Oso resource creation authorization:
  https://www.osohq.com/docs/modeling-in-polar/authorize-creates
- Payload access control and field access control:
  https://payloadcms.com/docs/access-control/overview
  https://payloadcms.com/docs/access-control/fields
- Supabase custom claims and RBAC:
  https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac
- OWASP Password Storage Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

## Findings

NIST RBAC is the right baseline vocabulary for the framework. It separates
users, roles, permissions, user-role assignment, and permission-role assignment,
with hierarchical RBAC as an extension. That maps cleanly to this project's
need for organizational roles and permission grants.

Casbin's "RBAC with domains" is the closest off-the-shelf shape to
tenant-scoped roles. It models the same user having different roles in
different domains such as tenants or workspaces. This validates storing role
assignments with an explicit scope/domain rather than making roles globally
effective.

OpenFGA and Zanzibar-style ReBAC shift the model from "user has permission" to
"user has a relationship to object." That is powerful for document-specific
sharing and deeply relational products, but it introduces a separate modeling
language, relationship tuple storage, and resource-oriented thinking. It is
more than the framework MVP needs unless every document must carry independent
relationship ACLs.

Cedar is a stronger policy-language option than simple RBAC when the framework
needs principal/resource/action/context checks, entity hierarchies, and
attribute conditions. It is attractive as a future optional policy backend, but
it is not a necessary first implementation for a starter app whose primary
need is scoped admin RBAC.

Cerbos follows a policy-decision-point pattern with resource policies, roles,
conditions, and scoped policies. It is a good reference for keeping resource
policy declarations separate from enforcement calls, but adding a separate PDP
is too much infrastructure for the first Nuxt starter MVP.

Payload's code-driven access control is useful evidence for this framework's
DX: collection-level functions can secure API operations and drive admin UI
visibility from the same declarations. Its flexibility is valuable, but leaving
all access as arbitrary code functions would make generated UI and consistent
business-action authorization harder.

Directus validates the CMS/admin pattern of relational users, roles, policies,
and role hierarchy. Its public-role default-off behavior also supports a
default-deny stance for the starter.

PostgreSQL Row-Level Security is a strong defense-in-depth option, especially
for row filtering, but the framework should not start there. The current data
layer already enforces tenant context in application services; adding auth/RBAC
first at the service and route boundary keeps behavior portable, testable, and
easier to evolve before encoding policies inside SQL.

Nuxt's official session recipe points toward simple sealed-cookie sessions via
Nuxt Auth Utils. That fits the starter's simple username/password MVP, while
the framework should keep canonical user identity independent of the session
mechanism.

Keycloak's authorization model reinforces the separation between protected
resources, scopes/actions, permissions, policies, and enforcement. Its default
enforcing mode is a useful reminder that missing policy should deny by default,
not fall open.

Oso's resource-creation guidance calls out the "resource does not exist yet"
problem. For this framework, create authorization should be checked against the
requested parent/container scope before the new document is inserted.

Payload's access control model supports the service design choice that access
checks run before operations complete. Payload also explicitly skips access
control for trusted local API calls by default, which is a useful precedent for
keeping this framework's trusted bootstrap/local APIs clearly separate from
actor-protected service APIs.

Supabase's custom-claims RBAC pattern and PostgreSQL RLS guidance validate RLS
as a future defense-in-depth layer, but not as the first framework contract.
The service API should compute and enforce access in TypeScript first, then RLS
can be added once the contract stabilizes.

OWASP password storage guidance supports using modern adaptive password hashing
for the starter username/password adapter. The implementation should prefer
Argon2id and store algorithm/parameter metadata to support later upgrades.

## Evaluated Designs

### Subject-Scoped RBAC

Users belong to a scope tree. Roles are assigned to scopes. Users inherit
permissions from their own scope and ancestors.

This is simple and fits menus, buttons, route access, and feature availability.
The risk is that document data is effectively tenant-wide once a user has a
capability unless every business query remembers to add its own scope filter.

This model was considered but not selected as the core MVP shape because it
requires assigning users themselves into the scope tree. That is convenient for
some organizations but awkward when a user needs different responsibilities in
unrelated branches.

### Resource-Scoped RBAC

Users receive scoped role assignments, and documents/actions also resolve to an
authorization scope. A request is allowed only when the user's role assignment
scope contains the resource/action scope and the role grants the required
capability.

This is safer for department/team/region-owned records and enables automatic
list filtering. The cost is an extra concept on collections: how the framework
finds the resource scope for create/read/update/delete/action checks.

The selected variant uses a nullable document `authScopeId`. A `null`
`authScopeId` means the resource is tenant-root/global, not unscoped broad
access. This keeps a unified containment check while avoiding mandatory scope
assignment for every document.

### Relationship-Based Authorization

Documents become objects in a relationship graph, and access asks whether the
user has a relation to the object. This is the most expressive option, but it
does not fit the MVP's goal of a simple framework-owned relational schema and
consistent Nuxt starter DX.

### Policy Engine / PDP

Policies live in a purpose-built language or service such as Cedar or Cerbos.
This can support ABAC and complex rules, but it adds language/runtime
integration, policy validation, deployment, and debugging concerns before the
framework has stabilized its own admin data model.

## Recommendation

Use resource-scoped RBAC with a tenant-root default:

- Model identity, credentials, tenant memberships, scope tree, roles,
  permissions, grants, and assignments in relational system tables.
- Keep canonical user IDs as generated UUIDs.
- Store scope ancestry in a closure table.
- Treat username/password auth as the starter adapter, not as the
  authorization core.
- Represent permissions as stable capability strings.
- Let roles grant capabilities.
- Let role assignments bind a user to a role at a scope.
- Do not require users themselves to belong to the scope tree for
  authorization. Users receive authority through role assignments at scopes.
- Give documents optional framework metadata `authScopeId`.
- Treat `authScopeId = null` as tenant-root/global resource scope.
- For ordinary document operations, check that the actor has a role assignment
  whose scope contains the target resource scope and whose role grants the
  required capability.
- For create operations, authorize against the requested target scope before
  the document exists.
- Keep trusted bootstrap/local service APIs visibly separate from
  actor-protected APIs.
- Prefer default-deny behavior: unknown collection/action capabilities, missing
  permissions, missing scopes, or missing actor context should fail closed.
- Allow an explicit code-defined `resourceScope: "none"` escape hatch only for
  truly capability-only operations that should not participate in resource
  containment.
- Keep collection/action auth bindings code-defined so authorization semantics
  stay versioned with application code.
- Keep role definitions, grants, assignments, users, and scopes editable
  relational runtime data.
- Defer OpenFGA/Cedar/Cerbos-style policy engines until real applications need
  object-sharing, ABAC conditions, or cross-service policy administration.
- Defer PostgreSQL RLS until the service-level contract is stable, then add it
  as defense in depth for core tables and documents.

This recommendation avoids placing users inside the scope tree while preserving
hierarchical resource access. It should be easier to explain than full ReBAC
and safer than pure subject-scoped RBAC.
