-- mindspace: per-workspace manual project ordering.
-- Adds a `position` column to projects so users can reorder via drag-and-drop.
-- Uses a sparse double-precision sequence so we can insert between two
-- existing items by setting position to their midpoint, with no global
-- renumbering. Run after 0004_sharing.sql.

alter table public.projects
	add column if not exists position double precision;

-- Backfill: preserve the current "most recently updated first" order.
-- We assign positions 1024, 2048, 3072, ... so there's plenty of room to
-- insert between siblings without ever needing to renumber.
with ranked as (
	select id,
		row_number() over (
			partition by workspace_id
			order by updated_at desc, id
		) as rn
	from public.projects
	where position is null
)
update public.projects p
	set position = ranked.rn * 1024
	from ranked
	where p.id = ranked.id;

-- New rows go to the top by default. Computed in the app, but we provide a
-- sensible fallback for inserts that omit position.
alter table public.projects
	alter column position set default 0;

create index if not exists projects_workspace_id_position_idx
	on public.projects (workspace_id, position);
