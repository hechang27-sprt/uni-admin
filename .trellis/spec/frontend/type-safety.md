# Type Safety

The project uses TypeScript through Nuxt project references, Zod for runtime
document validation, and Drizzle types for database rows.

## TypeScript Entrypoints

- `tsconfig.json` is a project-reference entrypoint with no root files.
- Use `bun run typecheck`, which runs `bunx tsc -b --noEmit`.
- `nuxt.config.ts` includes Bun types for node config and test-unit server
  includes for Nitro TypeScript.
- `vitest.config.ts` defines the `#server` alias for unit tests.

## Current Type Patterns

- Public document JSON types live in `server/data/documents/types.ts`.
- Service input/output types live in
  `server/data/documents/service/contracts.ts`.
- Repository record and interface types live in
  `server/data/documents/repository/types.ts`.
- Remote adapter types and `createRemoteProjectionMapper` live in
  `server/data/documents/remote.ts`.
- Test fixtures infer `TaskDocument` and `RemoteTask` from Zod schemas in
  `test/unit/server/fixtures/service.ts`.

## Validation

- Runtime document validation happens through Zod collection schemas.
- `createRemoteProjectionMapper` validates remote payloads before mapping them
  to local document projections.
- `parseData` wraps schema failures in `DocumentServiceError` with
  `VALIDATION_FAILED`.

## Anti-Patterns

- Do not use plain `tsc --noEmit`; it checks only the empty root project.
- Do not replace remote adapter callback typing with broad `unknown` defaults.
  The bivariance wrapper in `remote.ts` is intentional for heterogeneous
  adapter storage.
- Avoid `any` in contracts. Use `unknown` at external boundaries and validate
  with Zod or explicit guards before persistence.
