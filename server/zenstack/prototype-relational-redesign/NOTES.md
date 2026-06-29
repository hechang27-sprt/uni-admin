# NOTES

Question:

- Is the current ZenStack-first `DocumentBase` direction still viable once exercised against a real ZenStack v3 schema and policy runtime?

Verdict:

- Yes, provisionally. `bun run prototype:zenstack-relational-redesign` passes against a real ZenStack v3 schema, with PGlite as the runtime backend and `zen db push` applying the schema through a temporary `@electric-sql/pglite-socket` PostgreSQL URL bridge.
- After tightening, the prototype is now closer to the full draft relational sketch: `auth()` is actor-context shaped, app ownership lives in catalog metadata, `DocumentBase` only carries shared managed-row fields, and derived grants are modeled around `(actorContext, capabilityKey, grantScope)` plus row-aligned collection/app matching.
- The prototype also adopts the simplified identity model suggested during review: `App` is primary-keyed by `appKey`, `Collection` is primary-keyed by `(appKey, collectionKey)`, and the prototype avoids generic primary-key names for domain identities where a concrete name like `appKey` or `documentId` is clearer.
Observed results:

1. `DocumentBase` delegate inheritance works for managed subtypes.
   - Shared base fields are readable through `documentBase`.
   - Concrete subtype fields are readable through `projectDocument` / `lockedDocument` / `partnerProjectDocument`.
2. Tenant/scope/capability policy works against the richer actor-context model.
   - `ActorContext` can be the bound auth shape.
   - Derived grants tied to actor context and tenant still authorize reads/updates through the base policy.
3. A stricter managed subtype rule composes on top of the base contract.
   - `LockedDocument` remains visible to reads, but update attempts from the same actor fail through the policy surface.
4. Catalog/discriminator separation works.
   - App-local `collectionKey` stays in catalog metadata while `qualifiedCollectionKey` stays the globally unique discriminator used by delegate mapping.
   - `Collection` now uses `(appKey, collectionKey)` as its primary key; the surrogate collection row id is gone in the prototype.
5. `Permission` now follows the same catalog key shape as the rest of the prototype.
   - Collection-scoped permissions persist `appKey` + `collectionKey` and relate back to both `App` and `Collection`.
   - Permission seed order matters once that FK exists: collections must be created before collection-scoped permissions.
6. Exact collection/app alignment now works inside the base CRUD policy.
   - A `default:projects:*` grant no longer authorizes `partner:projects` rows.
7. Bottom-scope asymmetry can be modeled in the prototype policy.
   - Root/concrete project grants can read bottom-scoped project rows.
   - Explicit bottom-only project grants can read bottom-scoped rows.
   - Bottom-only project grants do not read ordinary child-scoped rows.
8. `DocumentBase` can carry explicit `appKey` and `collectionKey` alongside the persisted delegate discriminator.
   - The prototype now persists `appKey` and `collectionKey` on managed documents while keeping `qualifiedCollectionKey` as the physical delegate discriminator.
   - Create payloads for delegate subtypes need the scalar FK fields (`tenantId`, `authScopeId`, `appKey`, `collectionKey`) in this shape.

Important prototype findings:

- Base-model selects do not accept subtype-only fields. Query `documentBase` for shared fields, then query the concrete subtype model for subtype fields.
- The stricter subtype update denial still surfaced as `reason: 'not-found'` rather than `REJECTED_BY_POLICY`. That remains important for future framework error-shaping.
- Direct nested closure traversal inside the policy expression is still awkward in practice under ZenStack; the prototype keeps scope checks on row-owned `authScope.path` and treats bottom-scope rows as a special case.
- The clean PGlite + ZenStack seam here remains: PGlite runtime + `@electric-sql/pglite-socket` bridge for `zen db push` + ZenStackClient over `PGliteDialect`.

- `@@delegate` on an `@computed` discriminator schema-generates, but real delegate creates still fail in current ZenStack ORM. The create path inserts the discriminator as if it were a writable physical column, so `qualifiedCollectionKey` must remain persisted if delegate writes need to work.

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

**Resolution for now:** policy checks tenant isolation, exact row-aligned collection/app/capability matching, descendant-or-self scope matching through `this.authScope.path`, and a bottom-scope special case. Full closure-table traversal is still deferred from the policy engine.

**Implication:** if arbitrary scope-level RBAC enforcement inside ZenStack policy is a hard requirement, the remaining options are:
- Materialize a narrower policy-friendly reachable-scope surface.
- Wait for ZenStack to support deeper nested collection predicates.
- Use a different access model (for example, policy over a pre-joined view).

## Other findings

- ZenStack does not provide a built-in `concat(...)` policy function in this schema language. Exact capability-key matching is easier if derived grant rows also carry `collectionQualifiedKey` and `actionKey` separately.
- ZenStack does not auto-increment version fields on update; that's an app-layer responsibility.
- Composite unique constraints on compound FKs (e.g., `TenantApp.tenantId + appKey`) require the one-to-many relation from the FK-owning model; opposite relations must be declared on both sides.
- `UserPasswordCredential.userId` needs both `@id` and `@unique` for a one-to-one relation where the FK is also the PK.
- Postgres native UUID types + ZenStack's `@default(uuid(4))` work correctly with PGlite.
