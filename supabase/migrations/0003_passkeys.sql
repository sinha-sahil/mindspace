-- mindspace: passkey credentials (WebAuthn)
-- Run after 0002_workspaces.sql.

create table if not exists public.passkeys (
	credential_id text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	public_key text not null,                        -- base64url-encoded
	counter bigint not null default 0,
	transports text[] not null default '{}',
	device_type text,                                -- 'singleDevice' | 'multiDevice'
	backed_up boolean not null default false,
	device_name text,                                -- user-supplied label
	created_at timestamptz not null default now(),
	last_used_at timestamptz
);

create index if not exists passkeys_user_id_idx on public.passkeys (user_id);

alter table public.passkeys enable row level security;

-- A user can see + delete their own passkeys.
drop policy if exists "passkeys_select_own" on public.passkeys;
create policy "passkeys_select_own"
	on public.passkeys for select
	using (auth.uid() = user_id);

drop policy if exists "passkeys_delete_own" on public.passkeys;
create policy "passkeys_delete_own"
	on public.passkeys for delete
	using (auth.uid() = user_id);

-- Inserts and updates go through the server with the service role key,
-- so we don't need INSERT/UPDATE policies for the anon role.
