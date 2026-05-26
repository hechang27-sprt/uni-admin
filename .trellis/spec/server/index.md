# Server Guidelines

The server side currently owns the real framework behavior: a multi-tenant
document data layer, Kysely persistence, remote adapter projection flow, and
pgLite-backed tests.

## Guidelines Index

| Guide                                                   | Use For                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Data Layer Boundaries](./data-layer-boundaries.md)     | Module ownership, public exports, and where logic belongs                                   |
| [Document Service](./document-service.md)               | Service methods, validation, versions, errors, and remote write flow                        |
| [Repository And Database](./repository-and-database.md) | Kysely repository patterns, schema, query normalization, and migrations                     |
| [Remote Adapters](./remote-adapters.md)                 | Adapter contracts, projection mapping, output metadata, and remote semantics                |
| [Auth/RBAC](./auth-rbac.md)                             | User identity, tenant memberships, scope-tree RBAC, and actor-scoped document authorization |
| [Testing](./testing.md)                                 | pgLite setup, fixture style, and behavior coverage requirements                             |

## Source References

- `server/data/documents/index.ts` is the public document data-layer barrel.
- `server/data/documents/service/service.ts` implements `DocumentService`.
- `server/data/documents/repository/kysely.ts` implements
  `KyselyDocumentRepository`.
- `server/auth/index.ts` is the public auth/RBAC barrel.
- `server/db/schema.ts` defines the `tenants` and `documents` tables.
- `test/unit/server/service.test.ts` is the executable behavior reference.

## General Rules

- Treat `docs/data-layer-development-notes.md` as the maintainer explanation
  for current contracts.
- Keep framework behavior source-backed. If a spec and source disagree, inspect
  source first and update the spec.
- Run GitNexus impact analysis before editing functions/classes/methods, per
  `AGENTS.md`.
