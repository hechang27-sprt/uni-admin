# Uni Admin

A multi-tenant backend/BFF platform for building internal admin applications. It centers on a document-oriented data layer, built-in auth/RBAC, and explicit support for remote-backed business data and actions.

## Language

**Platform**:
The product itself: a multi-tenant backend/BFF used to build internal admin applications. It is not the admin application built on top of it.
_Avoid_: Admin app, CMS, internal tool

**Admin Application**:
A tenant-facing operational application built using the platform's data, auth, and action capabilities.
_Avoid_: Platform, CMS

**Tenant**:
The platform's primary isolation boundary for data and authorization. What a tenant corresponds to in the real world is intentionally left to the framework user rather than fixed by the platform.
_Avoid_: Customer, workspace, deployment

**Auth Scope**:
A tenant-local node in the authorization scope hierarchy. A permission assignment is effective for a target only when the target scope is reachable from the assignment scope through the scope closure model.
_Avoid_: Department, team, document scope

**Document**:
A platform-managed record shape stored in the document layer for a tenant collection. A document may be locally authoritative or a locally stored projection of a remote authoritative resource.
_Avoid_: Row, DTO, payload, always-source-of-truth record

**Document Scope**:
The auth scope attached to a document and used as its authorization target when collection permissions use document resource scope. It is not a separate scope system.
_Avoid_: Separate scope tree, document-only scope model

**Collection**:
A platform registration unit for a class of tenant documents. A collection defines document identity within the platform and owns the attached schema, capabilities, actions, and storage/query integration for that record set.
_Avoid_: Table, just-a-type, folder

**App**:
A module-level identity and policy boundary that groups related collections. An app owns collection namespace and tenant enablement within the platform, but is not itself the tenant or the whole platform.
_Avoid_: Collection, tenant, platform

**Capability**:
The canonical identity of an action the platform can authorize. Capabilities are derived from built-in platform behavior or registered collection actions and are the semantic thing roles ultimately grant.
_Avoid_: Permission, role, endpoint

**Permission**:
The persisted RBAC definition and grant surface for a capability, including its resource-scope mode and metadata. Permissions materialize capabilities into database-backed auth policy.
_Avoid_: Capability when persistence/grants are meant

**Role**:
An app-scoped named bundle of permissions intended to be reusable across tenants that enable that app. A role becomes effective for a user only through a scoped role assignment.
_Avoid_: Tenant-local role, job title, scope, assignment

**Role Assignment**:
The tenant-local grant of a role to a user at an auth scope. A role assignment is the mechanism that turns a reusable role into effective authority within a tenant.
_Avoid_: Global role membership, unscoped role grant

**Remote-Backed Collection**:
A collection whose authoritative business records live in an external system while the platform stores tenant-scoped local document projections for reads, authorization, and admin workflows. Remote-backed writes are remote-first, with local projection updated only after successful remote execution.
_Avoid_: Bidirectional replica, local-owned collection with side effects

**Session**:
An opaque authenticated state for a user, optionally narrowed to a selected tenant membership. A session carries login continuity and tenant selection, but does not cache effective permissions or replace live RBAC evaluation.
_Avoid_: Permission snapshot, cached authorization context

**User**:
The platform-wide identity for a person or account that can authenticate. A user may belong to multiple tenants through tenant memberships.
_Avoid_: Tenant, actor, membership

**Tenant Membership**:
The relation that makes a user eligible to select and act within a tenant. Membership determines whether a logged-in user can select that tenant.
_Avoid_: User, actor, role assignment

**Actor**:
The request-time identity used for authorization inside a tenant. An actor combines a user with its selected tenant.
_Avoid_: User, membership, session

**Action**:
A named non-CRUD operation exposed by the platform, usually representing explicit business behavior such as sync, submit, approve, or execute. Actions are distinct from the framework's built-in CRUD operations.
_Avoid_: Generic CRUD operation, implementation hook

**Action Attachment**:
The domain level at which an action is exposed. Current intended attachment levels are document-level, collection-level, and app-level.
_Avoid_: Endpoint shape, transport detail

**App-Level Action**:
An action attached at the app level rather than to a single collection or document. App-level actions may operate across multiple collections or over app-level concerns that do not belong to one collection boundary.
_Avoid_: Single-collection action by default, fake collection ownership

**Schema**:
A structural contract for document data. A schema describes data shape and validation, but is not the full collection concept.
_Avoid_: Collection, app, UI schema by default

**UI Schema**:
The schema that defines how an admin application presents or edits document data. UI schema is usually derived from data schema, but may be overridden when presentation or workflow needs differ.
_Avoid_: Data schema, collection definition, always-hand-authored schema

**Business System Boundary**:
The platform primarily acts as an admin-facing backend/BFF over business data and workflows, which may remain authoritative in external services. The model also permits the platform itself to become the authoritative home for business logic when a project chooses that shape.
_Avoid_: External-only by definition, platform-owned by definition

**Document ID**:
The platform-local identity of a document or projection. Document-level actions and platform-managed mutations operate on document ID even when the document is backed by a remote source.
_Avoid_: Remote ID, source-system primary key

**Remote Identity**:
The external authoritative identity of a remote-backed document, represented by its remote source and remote id. Remote identity links a local projection back to the source record without replacing the document's local platform identity.
_Avoid_: Document ID, global platform identity

**Document-Level Action**:
A named action attached to a specific document and invoked against the current row or record. A document-level action may update the current document, trigger remote behavior for its source record, or produce changes in other collections based on that document.
_Avoid_: Collection-wide batch action, app-level workflow

**Action Subject**:
The domain object an action is primarily invoked on and authorized against. For document-level actions, the primary subject is the platform document even when the implementation also uses remote identity to affect an external source record or related projections.
_Avoid_: Remote record as default subject, transport payload

**Row**:
In the data layer, a row means a row in the `documents` table: a document of a collection. In admin UI discussion, a table row often corresponds one-to-one with a document, but that is a common usage pattern rather than a platform-wide constraint.
_Avoid_: Separate domain primitive, guaranteed UI shape

**Shared Data Interface**:
The platform's generic data interface for collection-scoped document storage, retrieval, mutation, and registered actions. In the MVP it is intentionally narrow and does not try to absorb cross-collection workflows, complex joins, or reporting.
_Avoid_: Universal business query layer, cross-collection query abstraction by default

**Storage Model**:
For the MVP and initial v1, the platform assumes document-based storage as the only supported shared persistence model. Alternative storage shapes such as relational-backed collections are possible future directions but are not part of the current domain contract.
_Avoid_: Storage-agnostic collection model in current docs, relational-first assumption

**Document Lifecycle**:
The framework-level lifecycle of a document covers storage state only: existing, soft-deleted, restored, and hard-deleted. Business workflow states such as draft, approved, submitted, or executed belong to collection data and actions rather than the shared document lifecycle.
_Avoid_: Generic business workflow state machine

**Document Version**:
The platform-local optimistic concurrency token for a stored document or projection. For remote-backed collections, document version protects platform-side mutation and projection consistency rather than standing in for the authoritative version semantics of the external system.
_Avoid_: Remote system version by default, business workflow revision

**Document Scope Assignment**:
At the service layer and below, document scope must be explicit. Omitting document scope on create or scope mutation is not allowed. The assigned scope must be constrained by the actor's effective create authority for that collection, and the actor must not assign a higher scope than that authority permits.
_Avoid_: Implicit tenant-root defaulting, omitted scope on create, unspecified scope semantics, scope escalation on create

**Trusted Write Path**:
Outside bootstrap/setup flows, meaningful document writes should require actor context. Non-actor create-like write paths are not part of the intended steady-state service model.
_Avoid_: Silent trusted bypass for ordinary writes, actorless document mutation as a normal path

**Bootstrap Bypass**:
System/bootstrap authority is a separate concern from ordinary tenant-scoped authorization. The current `SYSTEM_TENANT_ID` may remain part of that chain, and a future system-level use of `admin:tenant:owner` or an equivalent bypass capability is possible, but it is not the default model for ordinary service writes.
_Avoid_: Mixing bootstrap authority with normal actor-scoped RBAC

**Tenant Owner**:
The tenant-wide business superuser capability boundary. `admin:tenant:owner` is intended to satisfy business-facing capability checks within a tenant, but it is not the default bypass for RBAC-governance, admin-management, or bootstrap/system authority concerns.
_Avoid_: Universal meta-authority, bootstrap/system bypass by default

**Business-Facing Capability**:
A capability that authorizes work on tenant business data and workflows, including collection CRUD, document-level actions, collection-level actions, and app-level business workflows.
_Avoid_: Governance/admin capability, bootstrap/system control

**Governance Capability**:
A capability that authorizes changes to the authorization model, tenant administration, or system-control surfaces, such as role management, permission grant/revoke, role assignment management, scope management, membership/user administration, and bootstrap-oriented controls.
_Avoid_: Ordinary business data operation

**Collection Capability**:
A capability derived from the framework's built-in collection operations such as read, create, update, patch, delete, restore, and hard-delete.
_Avoid_: Custom action capability, generic business verb

**Action Capability**:
A capability derived from a named custom action attached at the document, collection, or app level. Action capabilities authorize explicit business behavior rather than the framework's built-in CRUD surface.
_Avoid_: Built-in collection capability, generic CRUD operation

**Collection-Level Action**:
A higher-level action namespaced under a collection, typically referred to as `app-key:collection-key:action`. Its handler does not imply a single built-in authorization subject; instead, it is expected to derive and authorize the actual target scope or document set through framework-provided handles.
_Avoid_: Implicit single-document subject, fixed built-in target semantics

**App-Level Action Interface**:
At the handler-interface level, app-level and collection-level actions are expected to be similar: both receive framework-provided handles through which documents and authorization are manipulated. Their main difference is namespace shape, with app-level actions referred to as `app-key:action` and collection-level actions as `app-key:collection-key:action`.
_Avoid_: Artificially separate handler model without domain need

**Action Identity**:
Action identity is determined by its fully qualified namespace rather than by the bare action name alone. Bare action names may repeat across different collections or apps as long as the qualified action identity remains distinct.
_Avoid_: Global uniqueness of bare action names, unqualified action identity

**App Enablement**:
Enabling an app for a tenant makes that tenant eligible to use the app's shared collections, actions, and capabilities under tenant-local data isolation. It does not imply tenant ownership or copying of the app definition itself.
_Avoid_: Tenant-owned app copy, app instantiation by duplication

**App Configuration Override**:
Shared default app configuration lives on the app definition, while tenant app enablement may override that shared config for one tenant. Tenant config refines shared app behavior without changing the shared app definition for other tenants.
_Avoid_: Per-tenant app copy, globally mutating shared defaults when tenant override is intended

**Collection Ownership**:
A collection belongs to exactly one app. Its identity and capability namespace are app-scoped, and tenant access to the collection flows through enablement of that owning app.
_Avoid_: Multi-app collection ownership, app-independent collection identity

**Enablement Precondition**:
Tenant data and authorization under a collection are only valid when the tenant has enabled the collection's owning app. App enablement is not merely a UI feature toggle; it is the access precondition for that app's collection surface.
_Avoid_: Treating enablement as presentation-only toggle, app data outside enablement boundary

**Collection Registration**:
The authoring contract for a collection's schema, actions, capabilities, and storage integration. Registration is where a collection definition is declared in code.
_Avoid_: Stable runtime identity store, tenant-owned definition

**Catalog Identity**:
The persisted runtime source of truth for stable app and collection identity used by documents, permissions, and tenant enablement. Catalog identity materializes registered definitions into durable runtime identity.
_Avoid_: Mere cache of code registration, tenant-local collection naming

**Collection Key**:
A stable collection identity used in registration, namespacing, and runtime lookup. Collection key is part of the durable identity contract.
_Avoid_: Human-facing label, mutable descriptive name

**Collection Name**:
Human-facing descriptive metadata for a collection. Collection name is not part of the stable identity contract.
_Avoid_: Runtime identity key, namespace component

**App Key**:
A stable app identity used in namespacing, enablement, and runtime lookup. App key is part of the durable identity contract.
_Avoid_: Human-facing label, mutable descriptive name

**App Name**:
Human-facing descriptive metadata for an app. App name is not part of the stable identity contract.
_Avoid_: Runtime identity key, namespace component

**Permission Policy Field**:
A persisted field attached to a permission that affects authorization semantics without being treated as a separate permission identity by default. `resourceScope` currently belongs in this category, even though changing it is a meaningful policy migration.
_Avoid_: Treating every policy field as automatically minting a new permission identity, treating policy-bearing fields as mere descriptive text

**Permission Description Field**:
A persisted field attached to a permission that documents or classifies it without directly changing authorization semantics. Examples include human-facing descriptive fields.
_Avoid_: Confusing descriptive fields with authorization policy

**Document Metadata**:
Platform-managed fields attached to a document but outside the collection's business data schema. Document metadata covers platform identity, authorization, remote linkage, lifecycle, and concurrency concerns.
_Avoid_: Collection business payload, application-level arbitrary JSON

**Collection Data**:
The business payload governed by a collection's data schema. Collection data excludes platform-managed document metadata.
_Avoid_: Platform metadata, auth linkage, remote identity metadata

**Remote Linkage Metadata**:
Platform-managed metadata that identifies the external source record a remote-backed document projection corresponds to. Remote linkage metadata belongs to the platform contract rather than to collection business payload.
_Avoid_: Remote-derived business payload, ordinary collection data

**Remote-Derived Business Data**:
Collection data mapped or projected from an external source record into the platform's business payload shape. Remote-derived business data belongs to collection data after validation and mapping, even though it originated remotely.
_Avoid_: Remote linkage metadata, platform identity fields

**Synchronization**:
An explicit operation that refreshes or materializes local projection state from an external source. Synchronization is not an implicit side effect of ordinary reads.
_Avoid_: Transparent remote fallback during normal reads, hidden projection refresh

**Ordinary Read**:
A read operation over local platform state only. For remote-backed collections, ordinary reads consume local projections rather than calling the external source directly.
_Avoid_: Implicit remote sync, remote call as normal read behavior

**Remote-Backed Write**:
An intentional mutation or command sent to an external system for a remote-backed collection. Local projection state is reconciled only after the remote operation succeeds.
_Avoid_: Read-time refresh, implicit synchronization

**Remote-Backed Action**:
A named action whose primary business effect is executed against an external system and then reflected back into local projection state as needed. Remote-backed actions are distinct from synchronization even when both end in projection updates.
_Avoid_: Passive projection refresh, ordinary local-only CRUD by default

**Collection Surface**:
The caller-facing operations exposed by a collection, including reads, built-in writes, and actions. Remote-backed collections should preserve the same collection surface as local collections where practical, even though the underlying execution path differs.
_Avoid_: Leaking storage implementation details into every caller-facing contract

**Remote Adapter Hook**:
The collection-defined integration point that maps collection-surface operations to external system behavior and projection reconciliation for remote-backed collections.
_Avoid_: Treating remote-backed behavior as hidden local persistence detail

**Optional Remote CRUD**:
The collection surface should remain uniform even for remote-backed collections, but remote-backed built-in writes are conceptually remote-first when remote authority exists for that operation. The platform should avoid exposing a non-uniform collection interface outside custom-defined actions, while still preserving the remote-first meaning of remote-backed writes.
_Avoid_: Leaking per-collection CRUD shape differences into ordinary callers, silently redefining remote-backed writes as local-only mutations

**Storage Visibility**:
The distinction between local and remote-backed collections should stay hidden from ordinary collection-surface usage, while remaining explicit in collection definition and introspection metadata so maintainers, tooling, and admin surfaces can reason about it.
_Avoid_: Forcing ordinary callers to branch on storage model everywhere, hiding storage model completely from tooling

**Introspection Metadata**:
Declarative metadata that describes structural, behavioral, and policy-relevant collection contracts for tooling, maintainers, and admin surfaces. Introspection metadata may expose collection shape, storage kind, action surface, and policy-relevant contract details without replacing actual enforcement paths.
_Avoid_: Treating introspection as the enforcement engine, hiding policy-relevant collection contract details from tooling

**Introspection/UI Boundary**:
Introspection metadata explains what the platform contract is, while UI schema explains how an admin interface should present or edit it. Introspection metadata may inform UI generation, but it is not itself the UI schema.
_Avoid_: Treating introspection metadata as presentation schema, collapsing UI concerns into runtime contract metadata

**Frontend API Boundary**:
Frontend APIs expose domain operations, but transport shape is not the domain model. Collection surfaces, actions, auth, and session concepts remain primary; route or RPC forms are adapters over those concepts.
_Avoid_: Treating transport payloads or route structure as the source of domain vocabulary

**Control Plane**:
The platform surface that establishes identity, membership selection, session continuity, and actor context. Auth and session APIs belong to the control plane.
_Avoid_: Treating auth/session as just another business module

**Operational Plane**:
The platform surface that performs collection and business operations within an already established actor context. Collection and business APIs belong to the operational plane.
_Avoid_: Mixing actor-establishment concerns into ordinary business operation contracts

**Tenant Administration**:
The governance surface that controls who may act in a tenant and how tenant authority and tenant-scoped configuration are structured. Memberships, scopes, roles, grants, and tenant-level governance belong here.
_Avoid_: Ordinary app business operation, collection workflow mutation

**App Business Administration**:
The operational administration of business data and workflows exposed through enabled apps within a tenant.
_Avoid_: Tenant governance, membership/role/scope control

**Reusable Definition / Effective Authority Boundary**:
Apps may provide reusable policy and operation definitions across tenants, but effective authority only exists inside a tenant through tenant-local enablement, assignments, memberships, and actor context.
_Avoid_: Treating reusable app definitions as automatically conferring cross-tenant authority

**Capability Existence / Grantability Boundary**:
A capability may exist as part of a reusable app, collection, or action definition without being effective anywhere. Capability effectiveness requires tenant-local enablement and grant state; declared capability is not the same as granted authority.
_Avoid_: Treating declared capabilities as automatically usable authority

**Permission Sync**:
Definition maintenance that materializes declared capabilities into persisted permission definitions.
_Avoid_: Tenant grant decision, role assignment logic

**Grant Management**:
Tenant governance that decides which roles and assignments receive persisted permissions.
_Avoid_: Capability declaration sync, definition materialization

**Role Ownership**:
A role is co-owned by one tenant and one app. Roles are tenant-governed runtime policy objects, but each role belongs to exactly one app within that tenant.
_Avoid_: Cross-tenant shared role definition, app-free role identity

**Role Scope Boundary**:
A role definition is scope-free in the domain model. Scope enters only through tenant-local role assignment and later access evaluation.
_Avoid_: Implied role-local scope ceiling, scope-bearing role identity

**Role Availability**:
Roles are available only inside the tenant that owns them, and only in relation to the app that owns them.
_Avoid_: Cross-tenant reusable role pool, app-free role availability

**Role Customization Boundary**:
Runtime role definition and mutation are tenant-local governance concerns, but always within one app boundary.
_Avoid_: Shared cross-tenant role definition, cross-app role composition

**Role / App Boundary**:
A role may contain capabilities from exactly one app. Apps define the capability namespace available to a role; tenants define how to bundle and use those capabilities through roles within that app boundary.
_Avoid_: Multi-app role composition, reintroducing fully app-owned shared-role semantics

**Role Disablement Semantics**:
When an app is disabled for a tenant, roles co-owned by that tenant and app persist but become ineffective until the app is enabled again.
_Avoid_: Destructive role cleanup as the default effect of app disablement

**Assignment Disablement Semantics**:
When an app is disabled for a tenant, role assignments tied to that tenant-app boundary persist but become ineffective until the app is enabled again.
_Avoid_: Destructive assignment cleanup as the default effect of app disablement

**Role Scope Reachability Rule**:
Roles co-owned by a tenant and an app use ordinary tenant scope reachability only. App ownership does not introduce a second app-specific scope hierarchy or extra scope restriction beyond tenant-local RBAC reachability.
_Avoid_: Hidden app-local scope axis on top of tenant scope reachability

**Role Capability Reconciliation**:
Tenant-owned app roles should be reconciled against the current capability set of their owning app. Role definitions must not silently remain semantically valid if they reference capabilities that have been removed or changed incompatibly, even if the exact migration workflow is still open.
_Avoid_: Treating stale capability references as indefinitely valid role contents

**Invalid Role Assignment Semantics**:
Assignments of a role that has become invalid through capability reconciliation should persist but become ineffective until the role is repaired.
_Avoid_: Destructive assignment cleanup as the default response to invalid role contents

**Configuration / Capability Boundary**:
Tenant configuration may change business behavior implemented under a capability, but it must not silently redefine the capability's authority class, scope semantics, or core authorization identity.
_Avoid_: Using tenant config to smuggle authorization-model changes behind a stable capability name

**Tenant Configuration**:
Tenant-local configuration that customizes how an enabled app behaves for one tenant, including overrides of the shared `apps.config` default through tenant app configuration. Tenant configuration is behavioral customization rather than an authority grant.
_Avoid_: Treating configuration overrides as permission grants

**Opaque Configuration Surface**:
App and tenant configuration are currently opaque JSON configuration surfaces rather than schema-governed platform contracts. Until config schemas are formalized, compatibility, validation, and migration remain consumer-defined rather than enforced as shared platform rules.
_Avoid_: Pretending raw JSON config already has a first-class platform schema contract

**Tenant Authority**:
The tenant-local authorization state that determines who may act and what they may do inside a tenant. Memberships, roles, assignments, scopes, and governance belong here.
_Avoid_: Treating behavioral configuration as authority

**Invalid Role State**:
When tenant-owned app roles become incompatible with their app's current capability set, that invalidity should be treated as a first-class visible state rather than as purely silent ineffectiveness.
_Avoid_: Hiding broken role definitions behind implicit evaluation failure alone

**Collection Schema Version**:
The version of a collection's data contract.
_Avoid_: Per-document optimistic concurrency token

**Document Version**:
The version tracking concurrent mutation of one stored document or projection instance. Document version and schema evolution are separate concerns.
_Avoid_: Collection-wide schema contract version

**Definition Existence / Tenant Data Boundary**:
A reusable collection definition may exist without any tenant data. Tenant data existence depends on tenant enablement and actual document or projection creation rather than on the mere existence of the shared definition.
_Avoid_: Assuming every declared collection already has tenant data

**Bootstrap Data**:
Bootstrap or seed data is not a separate kind of tenant data. If initial data is needed, it should be created through the ordinary collection surface under an appropriate superuser/system identity rather than through a separate data model.
_Avoid_: Special bootstrap-only tenant data category

**System Identity**:
System-level superuser identity is distinct from ordinary tenant actors and may operate under `SYSTEM_TENANT_ID` for bootstrap or platform-level setup concerns.
_Avoid_: Treating ordinary tenant actor identity as system bootstrap identity

**System Identity / Tenant Owner Boundary**:
System identity and tenant owner are separate authority concepts. `SYSTEM_TENANT_ID` does not rely on a globally connected scope tree. Instead, a system-level superuser may be granted the required admin permissions at a target tenant root scope for bootstrap work, then perform bootstrap operations under that tenant-scoped authority. `admin:tenant:owner` remains an admin-app business capability that only stands in for business-facing permissions within the scope where it is assigned.
_Avoid_: Treating tenant owner as system identity, collapsing bootstrap authority into tenant business authority, treating tenant owner as tenant-wide override regardless of assignment scope

**Tenant-Local Scope Meaning**:
Tenant-local auth scope remains a meaningful concept because tenant scope trees are not globally unified under a system top scope. Cross-tenant bootstrap authority should be expressed by explicit tenant-root grants for the acting system user rather than by a shared ancestor scope.
_Avoid_: Treating bootstrap authority as proof that tenant-local scope reasoning should be collapsed

**Orthogonal Isolation Dimensions**:
`tenant_id` and `app_id` are orthogonal dimensions in the model. `tenant_id` carries data isolation and tenant-local authority context, while `app_id` carries reusable app/module identity and ownership of collections, roles, and capabilities.
_Avoid_: Treating app ownership as tenant isolation, treating tenant identity as app identity

**Bootstrap Grant Model**:
Bootstrap authority uses ordinary RBAC grants and assignments rather than a separate bootstrap-only grant type. The bootstrap process may take a user argument and establish that user as the initial tenant-scoped admin by granting the required authority at tenant root.
_Avoid_: Separate bootstrap-only grant primitive, assuming bootstrap grants must be temporary

**Initial Tenant Admin**:
The first tenant-scoped admin established during bootstrap, from whom ordinary tenant permissions and governance can proceed. This may be the bootstrapping user or another designated user.
_Avoid_: Assuming bootstrap must permanently use a system actor for ordinary tenant governance

**Initial Tenant Admin Boundary**:
Initial tenant admin describes how tenant authority begins, not a separate enduring authority type. It is the first holder of tenant-governance authority, after which ordinary tenant roles and permissions can evolve.
_Avoid_: Treating initial tenant admin as a separate permanent authority class

**Scope Breadth / Authority Class Boundary**:
Scope breadth and authority class are separate axes. A tenant-root assignment may still be either business-facing or governance-facing; tenant-root scope alone does not imply governance authority.
_Avoid_: Inferring governance power solely from broad scope assignment

**System App**:
A special first-class app that carries system-governance capabilities such as `system:*:*`. The system app is intended to be enabled only for `SYSTEM_TENANT_ID`, separating platform/bootstrap governance capabilities from ordinary tenant business apps.
_Avoid_: Mixing system-governance capabilities into ordinary tenant app surfaces

**Admin App / System App Boundary**:
The admin app governs tenant-facing administration inside ordinary tenant contexts. The system app governs platform/bootstrap administration tied to `SYSTEM_TENANT_ID`. Both are first-class apps, but they occupy different authority planes.
_Avoid_: Blurring `admin:*:*` and `system:*:*` capability families

**Tenant-Facing Administration**:
Administration the platform itself is concerned with inside an ordinary tenant context, such as users, scopes, roles, grants, tenant-local authority, and tenant-scoped configuration.
_Avoid_: End-user business workflow implementation

**End-User Business Administration**:
Business-data and workflow administration implemented by the end user of the framework on top of enabled business apps. It is tenant-scoped in usage, but not part of the platform's own administration model.
_Avoid_: Treating platform tenant governance as the same thing as application-specific business operations

**Platform-Owned App**:
An app that is part of the framework's own control, governance, or administration surface.
_Avoid_: End-user business app

**End-User App**:
An app defined by a framework user to model tenant business domains and workflows.
_Avoid_: Platform control-plane or governance app

**Platform-Owned / End-User-Defined Collection Boundary**:
Platform-owned and end-user-defined collections share the same collection model, but differ in authorship and purpose. Platform-owned collections implement framework control/governance surfaces; end-user-defined collections implement business-domain surfaces.
_Avoid_: Treating platform collections as a different collection kind by default

**Runtime-Managed App-Owned Role**:
An app-owned role that exists as a persisted runtime policy asset rather than a code-defined app definition. Runtime-managed app-owned roles remain reusable across tenants through app enablement without becoming tenant-owned role definitions.
_Avoid_: Treating every app-owned role as a code-authored asset, collapsing app-owned runtime roles into tenant-local roles

**Shared Role Governance (Provisional)**:
For now, shared app-owned role governance follows the existing tenant-root admin capabilities: a user assigned `admin:roles:create`, `admin:roles:update`, or `admin:roles:delete` at tenant root may perform the corresponding operation on shared app-owned roles. This is a provisional governance rule even though roles themselves are app-owned rather than tenant-owned.
_Avoid_: Assuming creator-only editability is already the active rule, assuming shared role governance has already been cleanly separated from tenant-root administration
