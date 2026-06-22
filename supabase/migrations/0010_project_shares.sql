-- mindspace: per-project sharing with specific people + constrained public links.
-- Run after 0009_doc_projects.sql.
--
-- Sharing model after this migration, in priority order:
--   1. People — explicit email grants in project_shares. The primary way to
--      share a project. Recipients must be allowlisted app members (the
--      server enforces this on insert); they view at /p/<id> after signing in.
--   2. Public link — visibility='link' now carries a constraint:
--      link_expires_at. The app always sets an expiry when enabling the
--      link; a null expiry is only possible for legacy rows.
--
-- Per the 0008 lesson, server-side checks (hooks.server.ts + /p/[id] load via
-- the admin client) are the primary access gate. The email-claim policies
-- below are a secondary layer for direct client reads and may be skipped by
-- the server paths entirely.

-- =============================================================
-- project_shares — explicit per-person grants on a project.
--   email   : the recipient (grants are by email so a project can be shared
--             before the person's first sign-in)
--   role    : 'viewer' today; 'editor' reserved for when shared editing ships
-- =============================================================
create table if not exists public.project_shares (
	id uuid primary key default gen_random_uuid(),
	project_id uuid not null references public.projects(id) on delete cascade,
	email text not null,
	role text not null default 'viewer' check (role in ('viewer', 'editor')),
	added_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now()
);

create unique index if not exists project_shares_project_email_idx
	on public.project_shares (project_id, lower(email));

create index if not exists project_shares_email_idx
	on public.project_shares (lower(email));

alter table public.project_shares enable row level security;

-- =============================================================
-- projects.link_expires_at — the public-link constraint.
-- null = no expiry (legacy rows only; the app always sets one).
-- =============================================================
alter table public.projects
	add column if not exists link_expires_at timestamptz;

-- =============================================================
-- Helpers
-- =============================================================

-- Does the current JWT's email hold a share on this project?
-- Email-claim matching is best-effort (see 0008); the server-side paths
-- don't rely on it.
create or replace function public.has_project_share(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.project_shares s
		where s.project_id = p_id
		  and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
	)
$$;

-- Can the current user manage shares on this project? Mirrors project write
-- rights: workspace owner or editor member.
create or replace function public.can_manage_project_shares(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.projects p
		where p.id = p_id
		  and public.is_workspace_editor(p.workspace_id)
	)
$$;

-- =============================================================
-- project_shares RLS
--   read  : workspace members of the parent project (to render the share
--           list) or the recipient themselves
--   write : workspace owner/editor of the parent project
-- =============================================================
drop policy if exists "project_shares_select" on public.project_shares;
create policy "project_shares_select"
	on public.project_shares for select
	using (
		exists (
			select 1 from public.projects p
			where p.id = project_shares.project_id
			  and public.is_workspace_member(p.workspace_id)
		)
		or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
	);

drop policy if exists "project_shares_editor_write" on public.project_shares;
create policy "project_shares_editor_write"
	on public.project_shares for all
	using (public.can_manage_project_shares(project_id))
	with check (public.can_manage_project_shares(project_id));

-- =============================================================
-- projects RLS
-- =============================================================

-- Replace the unconstrained 0004 public-read policy with an expiry-aware one.
drop policy if exists "projects_link_public_select" on public.projects;
create policy "projects_link_public_select"
	on public.projects for select
	using (
		visibility = 'link'
		and (link_expires_at is null or link_expires_at > now())
	);

-- People a project was shared with can read it.
drop policy if exists "projects_shared_select" on public.projects;
create policy "projects_shared_select"
	on public.projects for select
	using (auth.uid() is not null and public.has_project_share(id));

-- =============================================================
-- documents RLS — shared recipients can read the docs of a shared project.
-- (Write stays workspace-editor-only until shared editing ships.)
-- =============================================================
drop policy if exists "documents_shared_select" on public.documents;
create policy "documents_shared_select"
	on public.documents for select
	using (auth.uid() is not null and public.has_project_share(project_id));
