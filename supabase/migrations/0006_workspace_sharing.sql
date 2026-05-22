-- mindspace: shared workspaces.
-- Owner can rename/delete workspace and manage members.
-- Members come in two roles:
--   editor — can create/edit/delete projects in the workspace
--   viewer — can only read projects (no scene save, no rename, no delete)
--
-- Run after 0005_project_ordering.sql.

-- =============================================================
-- Members table
-- =============================================================
create table if not exists public.workspace_members (
	workspace_id uuid not null references public.workspaces(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('editor', 'viewer')),
	added_by uuid references auth.users(id) on delete set null,
	added_at timestamptz not null default now(),
	primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx
	on public.workspace_members (user_id);

alter table public.workspace_members enable row level security;

-- =============================================================
-- Helpers
-- =============================================================
create or replace function public.is_workspace_owner(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.workspaces w
		where w.id = ws_id and w.owner_id = auth.uid()
	)
$$;

create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.is_workspace_owner(ws_id)
	    or exists (
			select 1 from public.workspace_members m
			where m.workspace_id = ws_id and m.user_id = auth.uid()
		)
$$;

-- Editor = owner OR explicit editor member.
create or replace function public.is_workspace_editor(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.is_workspace_owner(ws_id)
	    or exists (
			select 1 from public.workspace_members m
			where m.workspace_id = ws_id
			  and m.user_id = auth.uid()
			  and m.role = 'editor'
		)
$$;

-- =============================================================
-- workspace_members RLS
--   Members can see the membership rows of any workspace they belong to
--   (so they know who else is on it). Only the owner can mutate.
-- =============================================================
drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
	on public.workspace_members for select
	using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_owner_write" on public.workspace_members;
create policy "workspace_members_owner_write"
	on public.workspace_members for all
	using (public.is_workspace_owner(workspace_id))
	with check (public.is_workspace_owner(workspace_id));

-- =============================================================
-- workspaces RLS — replace owner-only with member-aware policies
-- =============================================================
drop policy if exists "workspaces_owner_select" on public.workspaces;
drop policy if exists "workspaces_owner_update" on public.workspaces;
drop policy if exists "workspaces_owner_delete" on public.workspaces;

-- Members can see the workspace (so it shows up in their switcher).
create policy "workspaces_member_select"
	on public.workspaces for select
	using (public.is_app_member() and public.is_workspace_member(id));

-- Only the owner can rename or delete the workspace itself.
create policy "workspaces_owner_update"
	on public.workspaces for update
	using (public.is_app_member() and owner_id = auth.uid())
	with check (public.is_app_member() and owner_id = auth.uid());

create policy "workspaces_owner_delete"
	on public.workspaces for delete
	using (public.is_app_member() and owner_id = auth.uid());

-- (workspaces_owner_insert from 0002 is unchanged — only the creator inserts.)

-- =============================================================
-- projects RLS — read for any member, write for editors only
-- =============================================================
drop policy if exists "projects_ws_owner_select" on public.projects;
drop policy if exists "projects_ws_owner_insert" on public.projects;
drop policy if exists "projects_ws_owner_update" on public.projects;
drop policy if exists "projects_ws_owner_delete" on public.projects;

create policy "projects_ws_member_select"
	on public.projects for select
	using (public.is_app_member() and public.is_workspace_member(workspace_id));

create policy "projects_ws_editor_insert"
	on public.projects for insert
	with check (public.is_app_member() and public.is_workspace_editor(workspace_id));

create policy "projects_ws_editor_update"
	on public.projects for update
	using (public.is_app_member() and public.is_workspace_editor(workspace_id))
	with check (public.is_app_member() and public.is_workspace_editor(workspace_id));

create policy "projects_ws_editor_delete"
	on public.projects for delete
	using (public.is_app_member() and public.is_workspace_editor(workspace_id));
