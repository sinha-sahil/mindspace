-- mindspace: allow spreadsheet projects (kind='sheet').
-- Run after 0013_todo_projects.sql.
--
-- A "sheet project" stores its entire workbook — tabs of cells with formulas
-- and formatting — in projects.scene as JSONB, exactly like whiteboards store
-- their Excalidraw scene and todo boards store their columns. No new tables are
-- needed; we only widen the existing kind CHECK constraint (last set in
-- 0013_todo_projects.sql) to admit 'sheet' alongside the existing kinds.

alter table public.projects
	drop constraint if exists projects_kind_check;

alter table public.projects
	add constraint projects_kind_check
		check (kind in ('whiteboard', 'doc', 'todo', 'sheet'));
