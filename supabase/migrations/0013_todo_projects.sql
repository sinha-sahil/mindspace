-- mindspace: allow todo-list projects (kind='todo').
-- Run after 0012_comment_resolution.sql.
--
-- A "todo project" stores its entire board — columns of nested task/section
-- nodes with checkboxes — in projects.scene as JSONB, exactly like whiteboards
-- store their Excalidraw scene. No new tables are needed; we only widen the
-- existing kind CHECK constraint (added in 0009_doc_projects.sql) to admit
-- 'todo' alongside 'whiteboard' and 'doc'.

alter table public.projects
	drop constraint if exists projects_kind_check;

alter table public.projects
	add constraint projects_kind_check
		check (kind in ('whiteboard', 'doc', 'todo'));
