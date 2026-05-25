# Server Testing

Server data-layer tests should exercise the real Drizzle repository through
pgLite, not a fake repository.

## Current Test Setup

`test/unit/server/service.test.ts`:

- creates one pgLite database with `createInMemoryDb()`;
- wraps it in `DrizzleDocumentRepository`;
- runs Drizzle migrations before each test;
- seeds test tenants through `tenantsTable`;
- drops and recreates schemas after each test;
- closes `database.$client` after the suite.

`test/unit/server/fixtures/service.ts` owns reusable schemas, tenant IDs,
registry construction, document service construction, and remote adapter
fixtures.

## Vitest Configuration

`vitest.config.ts` defines three projects:

- `unit` for `test/unit/**/*.{test,spec}.ts` with Node environment and a
  `#server` alias to `./server`;
- `e2e` for `test/e2e/**/*.{test,spec}.ts`;
- `nuxt` through `defineVitestProject`.

Follow this layout for new tests. Server data-layer unit tests belong under
`test/unit/server/`.

## Coverage Expectations

Add or update tests when changing:

- collection validation or schema parsing;
- tenant isolation;
- optimistic concurrency and stale-version handling;
- JSON Patch behavior;
- list filters, sorting, pagination, or soft-delete inclusion;
- batch create/get/update behavior;
- actor-protected batch create/get/update allow and deny behavior, including
  one deduplicated `checkAccessMany` call per logical service operation;
- bulk owner bootstrap grants and delegated multi-capability assignment denial;
- cross-tenant auth-scope rejection when a batch contains mixed valid and
  invalid target scopes;
- remote adapter projection mapping and output passthrough;
- remote failure ordering.

## Assertions

- Prefer behavior assertions over implementation snapshots.
- Assert `DocumentServiceError` codes with `.toMatchObject({ code: "..." })`.
- For remote failures, assert both the thrown remote error and unchanged local
  projection state.
- For ordered APIs such as `getByIds`, assert result order and missing-item
  `null` entries.
