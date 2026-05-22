# Phase 8 · Integration

## Objective

Each module exposes a clean public surface via its `index.ts`; routes consume only the index.

## Tasks

- [ ] Each `client/modules/{name}/index.ts` exports:
  - The store singleton(s) where present
  - Type aliases for downstream consumers
  - UI components from `ui/index.ts`
- [ ] No deep imports from outside the module — routes hit only `index.ts`
- [ ] Update `routes/+page.svelte`, `routes/admin/+page.svelte`, `routes/auth/login/+page.svelte`, `routes/settings/passkeys/+page.svelte` to use module indexes
- [ ] Delete now-empty `lib/{stores,components,utils}/` directories

## Outputs

A grep for `'\$lib/(stores|components|utils|passkey)'` returns zero hits.

## Validation

```sh
pnpm check
pnpm lint
pnpm build
pnpm dev   # smoke test: login → workspace switch → create project → save scene → register passkey
```
