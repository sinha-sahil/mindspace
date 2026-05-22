# Phase 3 · Type Definitions

## Objective

Land all type-only declarations in their module's `types.ts`. Convert remaining `interface` to `type`.

## Tasks

- [ ] Audit every `interface` in `src/` and rewrite as `type`
- [ ] Per-module `types.ts` re-exports the relevant generated types from `$lib/generated/types`
- [ ] Local helper types (e.g. `StoreState`, `Project`, `Workspace`) move into the module's `types.ts`
- [ ] `database.types.ts` becomes thin: imports row types from generated, exports `Database` type for the Supabase client

## Outputs

- `interface` count in `src/` = 0
- Each module exports types only via its `types.ts`

## Validation

```sh
grep -rE "^interface |^export interface " src/ | wc -l
# → 0
pnpm check
```
