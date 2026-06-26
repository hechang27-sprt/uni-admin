# NOTES

Question:

- Is the current ZenStack-first `DocumentBase` direction still viable once exercised against a real ZenStack v3 schema and policy runtime?

Verdict:

- Yes, provisionally. `bun run prototype:zenstack-relational-redesign` passes against a real ZenStack v3 schema, with PGlite as the runtime backend and `zen db push` applying the schema through a temporary `@electric-sql/pglite-socket` PostgreSQL URL bridge.
- After tightening, the prototype is now closer to the full draft relational sketch: `auth()` is actor-context shaped, app ownership lives in catalog metadata, `DocumentBase` only carries shared managed-row fields, and derived grants are modeled around `(actorContext, capabilityKey, grantScope)` with explicit reachable-scope materialization.
- The prototype also adopts the simplified identity model suggested during review: `App` is primary-keyed by `key`, `Collection` is primary-keyed by `qualifiedKey`, and `DocumentBase` uses that same `qualifiedKey` as its delegate discriminator.

Observed results:

1. `DocumentBase` delegate inheritance works for managed subtypes.
   - Shared base fields are readable through `documentBase`.
   - Concrete subtype fields are readable through `projectDocument` / `lockedDocument`.
2. Tenant/scope/capability policy works against the richer actor-context model.
   - `ActorContext` can be the bound auth shape.
   - Derived grants tied to actor context and tenant still authorize reads/updates through the base policy.
3. A stricter managed subtype rule composes on top of the base contract.
   - `LockedDocument` remains visible to reads, but update attempts from the same actor fail through the policy surface.
4. Catalog/discriminator separation works.
   - App-local `collectionKey` stays in catalog metadata while `qualifiedKey` stays the globally unique discriminator used by delegate mapping.
5. Reachable descendant scopes can be materialized off the grant while preserving the conceptual `grantScope + closure` model.
   - The prototype now stores explicit reachable-scope rows for policy ergonomics, while still keeping the ancestor/descendant closure table present for structural fidelity.

Important prototype findings:

- Base-model selects do not accept subtype-only fields. Query `documentBase` for shared fields, then query the concrete subtype model for subtype fields.
- The stricter subtype update denial still surfaced as `reason: 'not-found'` rather than `REJECTED_BY_POLICY`. That remains important for future framework error-shaping.
- A direct nested closure traversal inside the policy expression was awkward in practice under ZenStack; the tightened prototype had to materialize `DerivedCapabilityGrantReachableScope` rows to keep the policy surface reliable.
- Under the simplified identity model, collection metadata remains explicit but authorization is still row/scope-driven. A sibling-scoped row created outside the grant's reachable scopes is correctly filtered out by policy.
- The clean PGlite + ZenStack seam here remains: PGlite runtime + `@electric-sql/pglite-socket` bridge for `zen db push` + ZenStackClient over `PGliteDialect`.

# Enrichment Round (2026-06-26)

Question: can the prototype carry the full framework-owned relational surface (catalog, RBAC, sessions, lifecycle metadata) while using closure-only scope matching in policy?

Verdict: yes for the surface breadth, but with a confirmed limitation on closure traversal.

## Changes

- Full Postgres-native types (@db.Uuid, @db.Timestamptz(6)) for identity/lifecycle fields.
- Added models: UserPasswordCredential, AuthSession, TenantApp, Permission, Role, RolePermission, RoleAssignment, ProjectRevision.
- Removed DerivedCapabilityGrantReachableScope.
- Added timestamps, version, remote identity, soft-delete fields to DocumentBase.

## Key finding: closure traversal in ZenStack policy

The expression `auth().capabilityGrants?[grantScope.closureAsAncestor?[descendantId == this.authScopeId]]` fails with `Field "closureAsAncestor" not found in model "DerivedCapabilityGrant"`. The policy engine cannot nest to-many `?[...]` collection predicates through a to-one → to-many chain.

**Resolution for now:** policy checks tenant isolation (`auth().tenantId == tenantId`) + capability presence (`auth().capabilityGrants?[capabilityKey == K]`). Full scope-closure authorization is deferred to the application layer.

**Implication:** if scope-level RBAC enforcement inside ZenStack policy is a hard requirement, the existing approach is either:
- Keep a narrow reachable-scope materialization per grant (the prior prototype's approach, which worked).
- Wait for ZenStack to support deeper nested collection predicates.
- Use a different access model (e.g., policy operates on a flat pre-joined view).

## Other findings

- ZenStack does not auto-increment version fields on update; that's an app-layer responsibility.
- Composite unique constraints on compound FKs (e.g., `TenantApp.tenantId + appId`) require the one-to-many relation from the FK-owning model; opposite relations must be declared on both sides.
- `UserPasswordCredential.userId` needs both `@id` and `@unique` for a one-to-one relation where the FK is also the PK.
- Postgres native UUID types + ZenStack's `@default(uuid(4))` work correctly with PGlite.
- Policy with capability presence + tenant isolation alone produces clean SQL without runtime errors.
