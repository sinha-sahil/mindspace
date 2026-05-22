# Phase 1 · Planning

## Objective

Map existing `src/lib` files to skulls module layout. Confirm utilities the template expects.

## Utility detection

| Tool | Expected by skulls | Status in mindspace |
|---|---|---|
| `type-crafter` | required for type generation | ✅ in `package.json`, generates to `src/lib/generated/` |
| `type-decoder` | runtime for generated decoders | ✅ added |
| `typesafe-api-call` | recommended | ❌ not used. Direct Supabase client + per-route `+server.ts`. Skipping. |
| Logger | `appLogger`/custom | ❌ none. Native `console` is the fallback. Out of scope. |

## Module inventory

| Module | Existing files | Target location |
|---|---|---|
| `workspaces` | `lib/stores/workspaces.svelte.ts` | `lib/client/modules/workspaces/store.ts` |
| `projects` | `lib/stores/projects.svelte.ts` | `lib/client/modules/projects/store.ts` |
| `passkeys` | `lib/passkey.ts`, `lib/server/passkey.ts` | client → `lib/client/modules/passkeys/remote.ts`; server stays in `lib/server/passkey.ts` |
| `theme` | `lib/stores/theme.svelte.ts` | `lib/client/modules/theme/store.ts` |
| `sidebar` | `lib/stores/sidebar.svelte.ts`, `lib/components/Sidebar.svelte` | `lib/client/modules/sidebar/{store.ts, ui/Sidebar.svelte}` |
| `auth` | login form lives in `routes/auth/login`, no client store today | UI helpers only — `lib/client/modules/auth/ui/Login.svelte` (extracted from route) |
| `whiteboard` | `lib/components/Whiteboard.svelte` | `lib/client/modules/whiteboard/ui/Whiteboard.svelte` |
| Shared primitives (Icon, Logo, Modal, MeshBackground) | `lib/components/*.svelte` | `lib/client/components/` (cross-module shared, not feature-specific) |

## Tasks

- [x] Read skulls `client-module` template
- [x] Inventory current files
- [x] Decide on module boundaries
- [x] Skip `typesafe-api-call` (justified above)
- [ ] Execute moves (subsequent phases)

## Outputs

This planning document.

## Validation

Inventory covers every file currently under `src/lib/{components,stores,passkey.ts}`.
