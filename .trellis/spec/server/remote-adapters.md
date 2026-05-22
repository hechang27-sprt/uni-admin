# Remote Adapters

Remote collection adapters let the framework keep a local JSONB projection of a
remote system while remote records remain source-of-truth.

## Adapter Contract

Remote adapter types live in `server/data/documents/remote.ts`.

Adapters define:

- `remoteSource`
- optional `idempotency` metadata for create/update/delete
- `syncOne`
- `syncList`
- `createRemote`
- `updateRemote`
- `deleteRemote`

The service stores heterogeneous adapters in the registry. The callback
bivariance wrapper in `remote.ts` is intentional; do not simplify it into
broader `unknown` callback defaults without rechecking strict function type
assignment.

## Projection Mapping

Use `createRemoteProjectionMapper` to validate a remote payload with Zod and map
it into the local document projection:

- `schema` validates the remote payload shape.
- `getRemoteId` extracts the remote identity.
- `mapData` returns the local document data shape.

The local projection still goes through the registered collection schema before
the repository write.

## Output Metadata

Remote result objects may include adapter-defined `output` metadata. The
service returns this metadata without interpreting it. Use it for provider
cursors, request IDs, checkpoints, rate-limit hints, or warnings. Do not bake
one provider's pagination shape into the framework.

## Semantics To Preserve

- Normal reads do not call remote adapters.
- Remote refresh is explicit through `syncRemoteOne` and `syncRemoteList`.
- Remote-first writes call the adapter before changing local projections.
- If a remote call throws, local projection data remains unchanged.
- Remote update/delete receive the current local `StoredDocument` in adapter
  context.

## References

- `test/unit/server/fixtures/service.ts` contains a fixture adapter with
  typed inputs, remote output metadata, idempotency metadata, and remote failure
  simulation.
- `test/unit/server/service.test.ts` verifies local-only reads, remote output
  passthrough, remote create/upsert behavior, and remote failure ordering.
