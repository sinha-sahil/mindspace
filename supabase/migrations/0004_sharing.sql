-- mindspace: project visibility + app invite tokens.
-- Run after 0003_passkeys.sql.

-- =============================================================
-- projects.visibility
--   'private' — owner only (default; matches existing behavior)
--   'link'    — anyone with the URL can view, read-only
-- =============================================================
alter table public.projects
	add column if not exists visibility text not null default 'private'
		check (visibility in ('private', 'link'));

-- Allow public read of link-shared projects.
-- Anon role sees only the visibility='link' rows.
drop policy if exists "projects_link_public_select" on public.projects;
create policy "projects_link_public_select"
	on public.projects for select
	using (visibility = 'link');

-- =============================================================
-- App invite tokens
--   Admins issue a tokenized URL. Anyone with the URL can claim
--   it (subject to expiry + use limit) to add their email to the
--   allowlist.
-- =============================================================
create table if not exists public.app_invites (
	token text primary key default encode(gen_random_bytes(16), 'hex'),
	created_by uuid references auth.users(id) on delete set null,
	grant_admin boolean not null default false,
	max_uses int,                                    -- null = unlimited
	use_count int not null default 0,
	expires_at timestamptz,
	note text,                                       -- optional human label
	created_at timestamptz not null default now()
);

create index if not exists app_invites_created_at_idx
	on public.app_invites (created_at desc);

alter table public.app_invites enable row level security;

-- Only admins can read/write directly; the public claim flow goes through
-- the server with the service-role key.
drop policy if exists "app_invites_admin_all" on public.app_invites;
create policy "app_invites_admin_all"
	on public.app_invites for all
	using (public.is_app_admin())
	with check (public.is_app_admin());
