# Hook And Composable Guidelines

This is a Nuxt/Vue project, so future shared stateful frontend logic should use
Nuxt composables rather than React-style hooks. There are no custom composables
implemented yet.

## Current Status

- No `app/composables/` directory exists.
- No generated collection composables exist.
- `docs/framework-dx-guide.md` sketches future helpers such as
  `useAdminCollection`, `useAdminMutation`, and `useAdminAction`, but those are
  design targets, not current APIs.

## Future Composable Rules

When composables are added:

- Name them with the Nuxt `use*` convention.
- Keep server-only database imports out of frontend composables.
- Route document operations through stable server/API boundaries once those
  exist; do not import `server/data/documents` directly into client code.
- Keep optimistic concurrency visible in mutation inputs by carrying
  `expectedVersion` from the stored document.
- Represent queued or pending operations explicitly once the operation queue is
  implemented.

## Data Fetching

Current data access is service-level TypeScript only. Until API routes exist:

- Use `new DocumentService(...)` in server-side tests and framework code.
- Document future composable examples as future API sketches only.
- Do not use frontend composables as the first place to define data-layer
  contracts; contracts belong in `server/data/documents/service/contracts.ts`.

## Anti-Patterns

- Do not add `use*` helpers that bypass validation, tenant scoping, or document
  service errors.
- Do not let composables invent response shapes that diverge from
  `DocumentService`.
- Do not cache remote-backed reads by calling remote adapters from the client.
  Current read semantics are local projection reads.
