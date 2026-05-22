-- mindspace: workspaces + app-level allowlist
-- Replaces 0001_init.sql. Run this in the Supabase SQL Editor.
-- Safe to run on top of 0001 (drops and recreates).

-- =============================================================
-- Tear down 0001 schema
-- =============================================================
drop table if exists public.projects cascade;

-- =============================================================
-- Helpers
-- =============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

-- =============================================================
-- App-level allowlist
--   Only emails listed here can use the app. is_admin = true grants
--   admin powers (manage allowlist, see /admin).
-- =============================================================
create table if not exists public.app_members (
	email text primary key,
	is_admin boolean not null default false,
	added_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now()
);

create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.app_members
		where lower(email) = lower(auth.email())
	)
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.app_members
		where lower(email) = lower(auth.email())
		  and is_admin = true
	)
$$;

-- =============================================================
-- Workspaces (owner-only access for now)
-- =============================================================
create table if not exists public.workspaces (
	id uuid primary key default gen_random_uuid(),
	name text not null check (char_length(name) between 1 and 200),
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists workspaces_owner_id_idx
	on public.workspaces (owner_id, created_at);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
	before update on public.workspaces
	for each row execute function public.set_updated_at();

-- =============================================================
-- Projects (live inside a workspace)
-- =============================================================
create table if not exists public.projects (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null references public.workspaces(id) on delete cascade,
	name text not null check (char_length(name) between 1 and 200),
	scene jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists projects_workspace_id_updated_at_idx
	on public.projects (workspace_id, updated_at desc);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
	before update on public.projects
	for each row execute function public.set_updated_at();

-- =============================================================
-- RLS
-- =============================================================
alter table public.app_members enable row level security;
alter table public.workspaces enable row level security;
alter table public.projects enable row level security;

-- ------- app_members -------
drop policy if exists "app_members_select_self_or_admin" on public.app_members;
create policy "app_members_select_self_or_admin"
	on public.app_members for select
	using (lower(email) = lower(auth.email()) or public.is_app_admin());

drop policy if exists "app_members_admin_write" on public.app_members;
create policy "app_members_admin_write"
	on public.app_members for all
	using (public.is_app_admin())
	with check (public.is_app_admin());

-- ------- workspaces -------
drop policy if exists "workspaces_owner_select" on public.workspaces;
create policy "workspaces_owner_select"
	on public.workspaces for select
	using (public.is_app_member() and owner_id = auth.uid());

drop policy if exists "workspaces_owner_insert" on public.workspaces;
create policy "workspaces_owner_insert"
	on public.workspaces for insert
	with check (public.is_app_member() and owner_id = auth.uid());

drop policy if exists "workspaces_owner_update" on public.workspaces;
create policy "workspaces_owner_update"
	on public.workspaces for update
	using (public.is_app_member() and owner_id = auth.uid())
	with check (public.is_app_member() and owner_id = auth.uid());

drop policy if exists "workspaces_owner_delete" on public.workspaces;
create policy "workspaces_owner_delete"
	on public.workspaces for delete
	using (public.is_app_member() and owner_id = auth.uid());

-- ------- projects -------
drop policy if exists "projects_ws_owner_select" on public.projects;
create policy "projects_ws_owner_select"
	on public.projects for select
	using (
		public.is_app_member() and exists (
			select 1 from public.workspaces w
			where w.id = projects.workspace_id and w.owner_id = auth.uid()
		)
	);

drop policy if exists "projects_ws_owner_insert" on public.projects;
create policy "projects_ws_owner_insert"
	on public.projects for insert
	with check (
		public.is_app_member() and exists (
			select 1 from public.workspaces w
			where w.id = projects.workspace_id and w.owner_id = auth.uid()
		)
	);

drop policy if exists "projects_ws_owner_update" on public.projects;
create policy "projects_ws_owner_update"
	on public.projects for update
	using (
		public.is_app_member() and exists (
			select 1 from public.workspaces w
			where w.id = projects.workspace_id and w.owner_id = auth.uid()
		)
	)
	with check (
		public.is_app_member() and exists (
			select 1 from public.workspaces w
			where w.id = projects.workspace_id and w.owner_id = auth.uid()
		)
	);

drop policy if exists "projects_ws_owner_delete" on public.projects;
create policy "projects_ws_owner_delete"
	on public.projects for delete
	using (
		public.is_app_member() and exists (
			select 1 from public.workspaces w
			where w.id = projects.workspace_id and w.owner_id = auth.uid()
		)
	);

-- =============================================================
-- Seed: sahil is the only admin
-- =============================================================
insert into public.app_members (email, is_admin)
values ('sahilsinha.dar@gmail.com', true)
on conflict (email) do update set is_admin = excluded.is_admin;
