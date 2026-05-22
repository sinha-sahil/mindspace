# Phase 5 · API Integration

## Objective

Co-locate per-module client-side network calls under `module/remote.ts`.

## Tasks

- [ ] `lib/passkey.ts` → `lib/client/modules/passkeys/remote.ts`
  - Functions: `isSupported`, `registerPasskey`, `loginWithPasskey`
  - Already uses generated decoders for body shape
- [ ] Workspaces / projects: API access happens *through* the Supabase client passed into the store; no separate `remote.ts` needed. Skip.
- [ ] Auth: login uses `supabase.auth.signInWithOtp` via the layout-injected client. No separate `remote.ts` needed. Skip.

`typesafe-api-call` not adopted in this pass — see `00-overview.md` rationale.

## Outputs

Passkey client transport co-located with the rest of the passkeys module.

## Validation

```sh
grep -r "from '\$lib/passkey'" src/ | wc -l
# → 0 (all imports updated)
pnpm check
```
