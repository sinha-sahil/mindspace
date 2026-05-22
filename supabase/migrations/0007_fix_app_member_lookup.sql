-- mindspace: defensive fix for the is_app_member() / is_app_admin() helpers.
--
-- These were defined in 0002 using auth.email(), which:
--   • isn't always available in older Supabase setups, and
--   • can return NULL when the JWT email claim is shaped slightly
--     differently than the helper expects.
--
-- The symptom was newly invited users hitting
-- "new row violates row-level security policy for table 'workspaces'" the
-- first time the client tried to auto-create their personal workspace.
--
-- This migration recreates both helpers using auth.jwt() -> 'email' which
-- is always present on an authenticated session.

create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.app_members
		where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
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
		where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
		  and is_admin = true
	)
$$;
