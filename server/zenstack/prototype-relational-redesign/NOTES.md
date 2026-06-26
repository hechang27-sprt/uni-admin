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
