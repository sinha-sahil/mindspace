# Phase 7 · UI Components

## Objective

Move feature-owned `.svelte` files into `module/ui/`. Cross-feature primitives go to `lib/client/components/`.

## Tasks

| Component               | Destination                                        |
| ----------------------- | -------------------------------------------------- |
| `Sidebar.svelte`        | `client/modules/sidebar/ui/Sidebar.svelte`         |
| `Whiteboard.svelte`     | `client/modules/whiteboard/ui/Whiteboard.svelte`   |
| `Icon.svelte`           | `client/components/Icon.svelte` (shared)           |
| `Logo.svelte`           | `client/components/Logo.svelte` (shared)           |
| `Modal.svelte`          | `client/components/Modal.svelte` (shared)          |
| `MeshBackground.svelte` | `client/components/MeshBackground.svelte` (shared) |

- [ ] Move each file
- [ ] Update import paths in `routes/`
- [ ] Leave `Icon.svelte`'s `?raw` SVG imports untouched (already aligned with rule "no inline SVGs")

## Outputs

`src/lib/components/` directory removed.

## Validation

```sh
[ ! -d src/lib/components ]
pnpm check
pnpm lint
pnpm build
```
