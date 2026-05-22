# Phase 4 · State Management

## Objective

Move the Svelte stores into their owning modules.

## Tasks

- [ ] `lib/stores/workspaces.svelte.ts` → `lib/client/modules/workspaces/store.ts`
- [ ] `lib/stores/projects.svelte.ts` → `lib/client/modules/projects/store.ts`
- [ ] `lib/stores/theme.svelte.ts` → `lib/client/modules/theme/store.ts`
- [ ] `lib/stores/sidebar.svelte.ts` → `lib/client/modules/sidebar/store.ts`
- [ ] Keep singleton-store pattern (no behavior change)
- [ ] `index.ts` per module re-exports the singleton(s)
- [ ] Update every import site to point at `$lib/client/modules/{name}`

## Outputs

`src/lib/stores/` directory removed.

## Validation

```sh
[ ! -d src/lib/stores ]
pnpm check
pnpm lint
```
