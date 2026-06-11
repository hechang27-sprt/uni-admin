# Implementation Plan

1. Inspect `DocumentService.list`, legacy read methods, and tests that call removed APIs.
2. Remove `getById`, `getByIds`, and `filterAccessibleDocuments` from service/contracts/exports.
3. Update `list` authorization behavior so it covers all previous accessible-document filtering semantics.
4. Replace tests and docs/spec references with list-based examples and expectations.
5. Run targeted unit tests for document service and affected type/lint checks.
6. Run GitNexus `detect_changes(scope: all)` and review impacted symbols.
