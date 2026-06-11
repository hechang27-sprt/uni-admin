# Unify DocumentService access through list

## Goal

Resolve GitHub issue #7 by removing the legacy `DocumentService.getById`, `DocumentService.getByIds`, and `DocumentService.filterAccessibleDocuments` APIs completely and making `DocumentService.list` the single read/query interface for local document retrieval and authorization filtering.

## What I already know

* Issue #7 explicitly asks to eliminate `DocumentService.getById`, `DocumentService.getByIds`, and `DocumentService.filterAccessibleDocuments` in favor of `DocumentService.list`.
* Issue #7 notes `ListDocumentServiceInput` may need an optional `operation?: CollectionOperation` to replace `filterAccessibleDocuments`.
* GitNexus impact before edit:
  * `DocumentService.getById`: LOW risk; one direct test caller in `test/unit/server/service.test.ts`.
  * `DocumentService.getByIds`: LOW risk; one direct test caller in `test/unit/server/service.test.ts`.
  * `DocumentService.filterAccessibleDocuments`: LOW risk; no indexed external callers.
* Server spec currently documents the older methods and must be updated if the public service surface changes.

## Requirements

* Remove `DocumentService.getById` completely from the service implementation and public contracts.
* Remove `DocumentService.getByIds` completely from the service implementation and public contracts.
* Remove `DocumentService.filterAccessibleDocuments` completely from the service implementation.
* Keep `DocumentService.list` as the single local read interface for id lookups, batch id lookups, filtering, sorting, pagination, soft-delete inclusion, and actor-scoped access filtering.
* Extend list input only as needed to preserve authorization semantics that previously depended on `filterAccessibleDocuments`; if needed, add `operation?: CollectionOperation` and default it to read behavior.
* Update all tests and docs/specs that still reference the removed APIs.
* Preserve existing tenant isolation, actor authorization, includeDeleted behavior, result ordering for id filters, and pagination semantics.

## Acceptance Criteria

* [ ] No source, test, or documentation reference remains to `DocumentService.getById`, `DocumentService.getByIds`, or `DocumentService.filterAccessibleDocuments` except historical issue text outside the repo.
* [ ] `DocumentService` exposes no `getById`, `getByIds`, or `filterAccessibleDocuments` methods.
* [ ] Existing service tests use `list` for single-id and multi-id retrieval.
* [ ] Protected list access still evaluates collection authorization once per list operation and filters denied documents correctly.
* [ ] Targeted unit tests for document service behavior pass.
* [ ] Typecheck/lint for affected TypeScript files pass if available.

## Definition of Done

* Tests updated or added where behavior changed.
* Specs/docs updated to describe the unified list interface.
* GitNexus `detect_changes()` reviewed before completion.

## Technical Approach

Use a clean cutover. Delete the legacy service methods instead of leaving aliases. Move any unique authorization behavior from `filterAccessibleDocuments` into `list` with an optional operation override only if required by current callsites. Replace test/doc examples with list-based id filters.

## Decision (ADR-lite)

**Context**: Three read helpers existed alongside `list`, causing an inconsistent interface and an incomplete previous cleanup.

**Decision**: Make `list` the only local read API. Single-document retrieval is represented as `list({ ..., ids: [id], limit: 1 })`; batch retrieval is represented as `list({ ..., ids })` plus caller-side mapping where positional nulls are needed.

**Consequences**: The public surface is smaller and more consistent. Callers that need scalar or positional-null behavior must derive it from list results, which keeps repository/service interfaces focused on one query path.

## Out of Scope

* Reworking remote sync/read APIs.
* Changing repository-level query contracts unless required by compile failures.
* Introducing compatibility aliases for removed methods.

## Technical Notes

* GitHub issue: `issue://7`.
* Relevant specs: `.trellis/spec/server/document-service.md`, `.trellis/spec/server/data-layer-boundaries.md`, `.trellis/spec/server/testing.md`.
* Likely files: `server/data/documents/service/service.ts`, `server/data/documents/service/contracts.ts`, `server/data/documents/service/index.ts`, `server/data/documents/index.ts`, `test/unit/server/service.test.ts`, docs under `docs/`.
