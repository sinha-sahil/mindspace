# Phase 6 · Utilities

## Objective

Module-private helpers go into the module's `utils.ts`. Cross-cutting helpers stay shared.

## Tasks

- [ ] `lib/utils/format.ts` (`formatDate`, `relativeTime`) — keep as a shared util at `lib/client/utils/format.ts` (used by 4+ modules)
- [ ] No module-private utilities exist today; phase becomes mostly a path update

## Outputs

`src/lib/utils/` moves to `src/lib/client/utils/`.

## Validation

```sh
grep -r "from '\$lib/utils/" src/ | wc -l
# → 0 (all updated)
```
