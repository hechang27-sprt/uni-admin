# Frontend Guidelines

These guidelines describe the frontend surface that exists today. The project is
currently a Nuxt 4 shell around a server-side document data layer; generated
admin routes, composables, tables, and form builders are future work.

## Current Shape

- `app/app.vue` is still the Nuxt starter shell with `NuxtRouteAnnouncer` and
  `NuxtWelcome`.
- `app/assets/css/main.css` imports Tailwind CSS.
- `nuxt.config.ts` enables Tailwind's Vite plugin, Pinia, Bun Nitro preset, and
  Nuxt test/type config.
- The user-facing framework API is not frontend-first yet. Current examples in
  `docs/framework-dx-guide.md` call the TypeScript document service directly.

## Guidelines Index

| Guide | Use For |
|-------|---------|
| [Directory Structure](./directory-structure.md) | Where app, server, docs, tests, and generated files live |
| [Component Guidelines](./component-guidelines.md) | Vue component conventions for the current Nuxt shell |
| [Hook Guidelines](./hook-guidelines.md) | Nuxt composable expectations and current absence of custom composables |
| [State Management](./state-management.md) | Pinia status and where state should live today |
| [Quality Guidelines](./quality-guidelines.md) | Test/type/build commands and review expectations |
| [Type Safety](./type-safety.md) | TypeScript, Nuxt project references, Zod, and generated aliases |

## Scope Rules

- Do not invent generated UI APIs yet. Keep frontend examples honest about what
  exists.
- Keep frontend code under `app/`; server framework code belongs under
  `server/`.
- If a change touches the document data layer, also read the server specs under
  `../server/`.
