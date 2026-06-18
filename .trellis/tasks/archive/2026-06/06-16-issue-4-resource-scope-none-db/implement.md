# Implementation Plan

## Phase 1 — Schema and contract cutover

- Add a forward migration for nullable `permissions.resource_scope`, storing resolved `resourceScope` metadata for collection operation/action permissions.
- Add a forward migration that makes `user_role_assignments.scope_id` nullable and replaces `user_role_assignments_unique` with null-aware uniqueness.
- Update `server/db/migrations/001-baseline.ts` so new databases include `permissions.resource_scope` and nullable bottom-scope assignments.
- Update `server/db/schema.ts` with `PermissionsTable.resourceScope` and `UserRoleAssignmentsTable.scopeId: string | null`.
- Update RBAC assignment input types in `server/auth/um/types.ts`, `server/auth/um/repository.ts`, and service wrappers to accept `scopeId: string | null`.

Validation after phase:

- `bun run typecheck`
- targeted auth/migration tests once added in later phases

## Phase 2 — Query and authorization semantics

- Extend collection auth resource scope mode in `server/data/collections/registry.ts` to include `"none"`.
- Extend permission sync so resolved operation/action auth metadata is persisted into `permissions.resource_scope` alongside collection permission definitions.
- Update document service auth branching in `server/data/documents/service/service.ts` so `"document"`, `"tenant-root"`, and `"none"` translate to explicit authorization target modes.
- Replace nullable `targetScopeIds` repository evaluation with explicit target modes; remove the normalization path that coalesces `null` to the tenant root scope id inside `checkCapabilities`.
- Refactor `server/db/query.ts` / repository evaluation so `resourceScope: "none"` checks target the virtual bottom scope: concrete scoped grants can satisfy bottom checks, explicit null/bottom grants can satisfy bottom checks, and bottom grants never satisfy concrete scope checks.
- Ensure list-access helpers for document scopes ignore bottom-scope assignments unless the method contract is explicitly expanded.

Validation after phase:

- `bun run typecheck`
- targeted `test/unit/server/auth-rbac.test.ts` cases

## Phase 3 — Tests and spec updates

- Add tests for registry parsing/resolution of `resourceScope: "none"` for built-in operation and custom action auth.
- Add tests for concrete scoped assignment authorization success on no-scope permissions.
- Add negative tests proving bottom-scope grants do not authorize tenant-root or document/child-scope resources, while existing tenant-root/document behavior remains unchanged.
- Add/adjust migration/schema tests for `permissions.resource_scope`, nullable `scope_id`, and null-aware uniqueness.
- Update `.trellis/spec/server/auth-rbac.md` and `.trellis/spec/server/repository-and-database.md` after implementation to capture the new contract.

Validation after phase:

- `bun test test/unit/server/auth-rbac.test.ts`
- `bun run typecheck`
- `bun run lint` if source/spec changes require the normal quality gate

## Review gates

- GitNexus impact before editing each modified function/class/method, per `AGENTS.md`.
- `detect_changes({ scope: "all" })` before commit to confirm expected flows.
- No compatibility shim: every caller should use the new explicit no-scope contract after cutover.
