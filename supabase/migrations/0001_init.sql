-- free-board: initial schema
-- Run this in the Supabase SQL Editor (Project → SQL → New query → paste → Run).

-- =============================================================
-- projects table
-- =============================================================
create table if not exists public.projects (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references auth.users(id) on delete cascade,
	name text not null check (char_length(name) between 1 and 200),
	scene jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_updated_at_idx
	on public.projects (user_id, updated_at desc);

-- =============================================================
-- updated_at trigger
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

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
	before update on public.projects
	for each row
	execute function public.set_updated_at();

-- =============================================================
-- Row Level Security
-- =============================================================
alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
	on public.projects for select
	using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
	on public.projects for insert
	with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
	on public.projects for update
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
	on public.projects for delete
	using (auth.uid() = user_id);
