# Directory Structure

Use the Nuxt 4 directory layout that already exists. The repository is a
single-app project, not a monorepo.

## Current Layout

```text
app/
  app.vue
  assets/css/main.css
server/
  data/documents/
  db/schema.ts
  db/migrate.ts
  db/migrations/
  util/kysely.ts
test/
  unit/server/
docs/
  README.md
  framework-dx-guide.md
  data-layer-development-notes.md
```

## Placement Rules

- Put Vue application files under `app/`. The current shell is `app/app.vue`.
- Put global CSS under `app/assets/css/`; `main.css` currently imports
  Tailwind with `@import "tailwindcss";`.
- Put framework server code under `server/`, not under `app/`.
- Put document data-layer code under `server/data/documents/`.
- Put the Kysely database contract in `server/db/schema.ts` and migration
  sources under `server/db/migrations/`.
- Put unit tests under `test/unit/`; current server data-layer tests live in
  `test/unit/server/service.test.ts` with helpers in
  `test/unit/server/fixtures/service.ts`.
- Put maintainer and usage docs under `docs/`.

## Naming

- Use kebab-case for split implementation files such as
  `service/create-service.ts`.
- Use `index.ts` barrels only at module boundaries, as in
  `server/data/documents/index.ts`, `repository/index.ts`, and
  `service/index.ts`.
- Keep test helpers in `fixtures/` when they construct reusable registries,
  adapters, schemas, or services.

## Anti-Patterns

- Do not add a `src/` directory unless the project intentionally migrates away
  from Nuxt's current `app/` and `server/` layout.
- Do not put database or repository code in Vue component folders.
- Do not create frontend route/composable examples that imply generated admin UI
  exists before the implementation is present.
