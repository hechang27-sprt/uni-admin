# Design: Unify DocumentService access through list

## Boundary

`DocumentService.list` owns all local document reads. The removed APIs must not remain as wrappers, overloads, type exports, docs examples, or tests.

## Contract

`ListDocumentServiceInput` remains the public read input. Add `operation?: CollectionOperation` only if `list` must authorize non-read collection operations for internal flows that used `filterAccessibleDocuments`. Default behavior remains read authorization.

Single item read:

```ts
const { items } = await service.list<TData>({
  tenantId,
  collection,
  ids: [id],
  includeDeleted,
  limit: 1,
});
const document = items[0] ?? null;
```

Batch id read:

```ts
const { items } = await service.list<TData>({ tenantId, collection, ids });
const byId = new Map(items.map((item) => [item.id, item]));
const ordered = ids.map((id) => byId.get(id) ?? null);
```

## Implementation Notes

* Delete `GetDocumentInput` and `GetDocumentsByIdsInput` contract exports if no remaining consumer needs them.
* Delete `DocumentService.getById` and `DocumentService.getByIds` methods.
* Inline or move `filterAccessibleDocuments` behavior into `list`; then delete the helper.
* Keep authorization helpers that are still used by mutation paths.
* Update specs/docs to avoid advertising removed methods.

## Compatibility

This is an intentional breaking cleanup requested by issue #7. Do not add deprecated aliases.

## Verification

Run targeted service tests and TypeScript diagnostics/checks for affected files. Run GitNexus `detect_changes(scope: all)` before reporting completion.
