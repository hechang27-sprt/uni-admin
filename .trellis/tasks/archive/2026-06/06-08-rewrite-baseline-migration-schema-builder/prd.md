# Rewrite baseline migration with Kysely schema builder

## Goal

Rewrite `server/db/migrations/001-baseline.ts` from whole-statement raw SQL table DDL to Kysely schema-builder migrations, while reviewing baseline indexes against current repository usage.

## Requirements

- Preserve the baseline table shape, constraints, defaults, delete behavior, and physical snake_case identifiers.
- Remove indexes whose uniqueness is redundant with existing primary keys.
- Add only usage-backed indexes that match current auth/RBAC and document repository query paths.
- Keep raw SQL narrowly scoped to DDL Kysely cannot express cleanly, such as extension creation, partial indexes, GIN indexes, and pgLite-compatible raw fragments if builder support is missing.
- Keep `down()` behavior equivalent: dropping baseline tables in dependency-safe order.

## Acceptance Criteria

- [ ] `001-baseline.ts` uses `db.schema.createTable(...)` for table creation.
- [ ] Redundant `(tenant_id, scope_id)` / `(tenant_id, role_id)` unique indexes are removed unless current usage proves they are necessary.
- [ ] New indexes are justified by existing query patterns.
- [ ] Existing pgLite server unit tests pass after migration rewrite.
- [ ] Typecheck passes.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
