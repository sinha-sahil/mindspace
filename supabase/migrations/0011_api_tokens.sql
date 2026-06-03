-- mindspace: long-lived API tokens for non-browser clients (MCP server, CLI).
-- Run after 0010_comment_threads.sql.
--
-- A raw token like `mind_<32-hex>` is shown to the user EXACTLY once at
-- creation. Only the SHA-256 hash and the first 12 chars (prefix, for
-- display) are persisted. Validation: client sends `Authorization: Bearer
-- <raw>`, server hashes it, looks up by hash, resolves to a user.

create table if not exists public.api_tokens (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	name text not null,
	token_hash text not null unique,
	token_prefix text not null,                  -- e.g. "mind_a3b4c5d6"
	created_at timestamptz not null default now(),
	last_used_at timestamptz,
	expires_at timestamptz                       -- null = never expires
);

create index if not exists api_tokens_user_idx on public.api_tokens (user_id, created_at desc);
create index if not exists api_tokens_hash_idx on public.api_tokens (token_hash);

alter table public.api_tokens enable row level security;

-- Only the owner manages their own tokens. The auth hook performs the
-- token-lookup itself with the admin client (so unauthenticated requests
-- can resolve a token to a user); RLS is just for direct list/revoke.
drop policy if exists "api_tokens_owner_select" on public.api_tokens;
create policy "api_tokens_owner_select"
	on public.api_tokens for select
	using (user_id = auth.uid());

drop policy if exists "api_tokens_owner_insert" on public.api_tokens;
create policy "api_tokens_owner_insert"
	on public.api_tokens for insert
	with check (user_id = auth.uid());

drop policy if exists "api_tokens_owner_delete" on public.api_tokens;
create policy "api_tokens_owner_delete"
	on public.api_tokens for delete
	using (user_id = auth.uid());
