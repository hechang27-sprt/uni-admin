# Component Guidelines

The frontend component surface is intentionally minimal right now. Treat this
file as guidance for adding the first real Nuxt admin UI without pretending it
already exists.

## Current Pattern

`app/app.vue` is the only Vue component:

- It uses a single `<template>` block.
- It keeps Nuxt starter behavior: `NuxtRouteAnnouncer` plus `NuxtWelcome`.
- There are no project-specific props, emitted events, layouts, or pages yet.

## Adding Components

When adding real UI:

- Use Vue single-file components under Nuxt's `app/` tree.
- Keep domain-specific page components close to their route/page area once
  routes exist.
- Use Tailwind classes through the configured Tailwind Vite plugin.
- Prefer simple typed props with Vue/Nuxt conventions. Do not introduce a
  custom component framework before there is repeated UI to abstract.
- Keep data-layer calls out of presentational components. Route handlers or
  composables should own service calls once those layers exist.

## Accessibility

- Preserve `NuxtRouteAnnouncer` in the app shell unless a replacement is added
  deliberately.
- Use semantic controls for admin actions, forms, and tables.
- For future generated tables/forms, keyboard navigation and visible focus
  states are part of the implementation, not optional polish.

## Anti-Patterns

- Do not add marketing-style landing pages for admin workflows.
- Do not hide framework state transitions in decorative cards or hero sections.
- Do not create components that call remote adapters directly. The document
  service boundary owns that interaction.
