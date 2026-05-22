# Mindspace · Client Module Restructure

## Goal

Realign `src/lib` to the skulls `client-module` template — feature-scoped modules under `src/lib/client/modules/` instead of the current type-scoped layout (`components/`, `stores/`, `server/`, etc.).

## Scope

In scope:
- New module layout under `src/lib/client/modules/{module}/` for: `workspaces`, `projects`, `passkeys`, `theme`, `sidebar`, `admin`, `auth`
- Each module containing `index.ts`, `store.ts`, `types.ts`, `remote.ts` (where API calls exist), `ui/*.svelte`
- Convert `interface` → `type` everywhere (skulls rule #1)
- Keep generated types under `src/lib/generated/` (already aligned)
- Keep server-only code under `src/lib/server/` (skulls template targets client modules; server lib stays)

Out of scope (this pass):
- `typesafe-api-call` migration — the project uses Supabase + per-route `+server.ts` endpoints; the SDK abstraction would add a layer with diminishing return. Documented as a future option, not adopted.
- Splitting +page.svelte routes per module — SvelteKit's file-system router enforces the route layout; modules are imported into routes
- Re-namespacing CSS / theme tokens

## Success Criteria

- All feature code lives under `src/lib/client/modules/{name}/`
- No remaining `interface` declarations in `src/`
- `pnpm check` clean
- `pnpm lint` clean
- `pnpm build` succeeds
- App still functions (sign-in → workspace → project → passkey)

## Dependencies

- Skulls MCP `client-module` template (read)
- type-crafter (already in use)
- type-decoder runtime (already installed)
