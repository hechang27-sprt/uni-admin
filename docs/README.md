# Uni Admin Docs

This directory tracks the framework design and the current developer
experience for the Nuxt-based admin framework.

## Start Here

- [Framework DX Guide](./framework-dx-guide.md) is the user/developer
  walkthrough. It shows how to use the current data layer API and where that
  differs from the intended future framework experience.
- [Data Layer Development Notes](./data-layer-development-notes.md) is the
  maintainer-facing design note for the local document layer and the current
  remote collection adapter slice.
- [Brainstorm](./brainstorm.md) records the original product direction and
  constraints.

## Documentation Shape

The docs intentionally separate different reader goals:

- Tutorial and guide material belongs in `framework-dx-guide.md`.
- Architecture, design tradeoffs, and implementation notes belong in
  `data-layer-development-notes.md`.
- Raw planning context belongs in Trellis task artifacts under `.trellis/tasks/`.

## Current Status

The implemented framework surface is still data-layer only. There are no stable
Nuxt route handlers, composables, generated tables, UI schema runtime, operation
queue, or custom action runner yet. Treat examples in the "current status" docs
as service-level TypeScript examples rather than final application APIs.
