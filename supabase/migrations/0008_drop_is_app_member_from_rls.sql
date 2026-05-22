-- mindspace: remove is_app_member() from RLS policies on workspaces/projects.
--
-- Why: is_app_member() does a case-insensitive email lookup against the JWT.
-- That means RLS depends on (a) the email claim being present and shaped
-- the way the helper expects, and (b) the email in app_members matching
-- the email in the JWT. Both have failed in practice (newly invited users
-- hit "new row violates row-level security policy" on workspace insert),
-- and they're impossible to debug without a Supabase impersonation flow.
--
-- The allowlist check already happens *before* any DB request reaches RLS:
-- src/hooks.server.ts:authGuard rejects (sign-out + redirect) any
-- authenticated user whose email isn't in app_members. Anything that
-- carries a valid JWT through to the database has *already* been
-- allowlisted on the way in.
--
-- So we drop is_app_member() from the policies entirely and key everything
-- on auth.uid()-based predicates that can't fail spuriously.

-- =============================================================
-- workspaces
-- =============================================================
drop policy if exists "workspaces_owner_insert" on public.workspaces;
create policy "workspaces_owner_insert"
	on public.workspaces for insert
	with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "workspaces_member_select" on public.workspaces;
create policy "workspaces_member_select"
	on public.workspaces for select
	using (auth.uid() is not null and public.is_workspace_member(id));

drop policy if exists "workspaces_owner_update" on public.workspaces;
create policy "workspaces_owner_update"
	on public.workspaces for update
	using (auth.uid() is not null and owner_id = auth.uid())
	with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "workspaces_owner_delete" on public.workspaces;
create policy "workspaces_owner_delete"
	on public.workspaces for delete
	using (auth.uid() is not null and owner_id = auth.uid());

-- =============================================================
-- projects (member read, editor write)
-- =============================================================
drop policy if exists "projects_ws_member_select" on public.projects;
create policy "projects_ws_member_select"
	on public.projects for select
	using (auth.uid() is not null and public.is_workspace_member(workspace_id));

drop policy if exists "projects_ws_editor_insert" on public.projects;
create policy "projects_ws_editor_insert"
	on public.projects for insert
	with check (auth.uid() is not null and public.is_workspace_editor(workspace_id));

drop policy if exists "projects_ws_editor_update" on public.projects;
create policy "projects_ws_editor_update"
	on public.projects for update
	using (auth.uid() is not null and public.is_workspace_editor(workspace_id))
	with check (auth.uid() is not null and public.is_workspace_editor(workspace_id));

drop policy if exists "projects_ws_editor_delete" on public.projects;
create policy "projects_ws_editor_delete"
	on public.projects for delete
	using (auth.uid() is not null and public.is_workspace_editor(workspace_id));

-- The link-shared public-read policy from 0004 (visibility = 'link') is
-- intentionally untouched — it has nothing to do with is_app_member().
