# Implementation Checklist

## Phase 1 · Planning

- [x] Inventory current files
- [x] Map to module boundaries
- [x] Decide on `typesafe-api-call` adoption (skipped — see overview)

## Phase 2 · Setup

- [ ] Create `src/lib/client/{components,utils,modules}/` directories
- [ ] Scaffold each module folder with `index.ts`, `store.ts` (where applicable), `types.ts`, `ui/`

## Phase 3 · Type Definitions

- [ ] All `interface` rewritten as `type` in `src/`
- [ ] Per-module `types.ts` populated
- [ ] `database.types.ts` thin-wrapping generated rows

## Phase 4 · State Management

- [ ] `workspaces` store moved
- [ ] `projects` store moved
- [ ] `theme` store moved
- [ ] `sidebar` store moved
- [ ] All call sites updated

## Phase 5 · API Integration

- [ ] `passkeys/remote.ts` created from `lib/passkey.ts`
- [ ] Workspace/projects/auth: skipped (use Supabase client directly)

## Phase 6 · Utilities

- [ ] `format.ts` moved to `lib/client/utils/`

## Phase 7 · UI Components

- [ ] `Sidebar.svelte` → sidebar module
- [ ] `Whiteboard.svelte` → whiteboard module
- [ ] Shared primitives → `lib/client/components/`

## Phase 8 · Integration

- [ ] Module `index.ts` exports curated
- [ ] Routes only import via module indexes
- [ ] Old directories deleted

## Verification

- [ ] `pnpm check` clean
- [ ] `pnpm lint` clean (0 errors)
- [ ] `pnpm build` succeeds
- [ ] Smoke test: login → workspace → project create → scene save → passkey register
