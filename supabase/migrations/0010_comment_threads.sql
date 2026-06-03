-- mindspace: turn document comments into chat threads.
-- Run after 0009_doc_projects.sql.
--
-- A "thread" is a single text-anchored conversation. The thread root row
-- carries the anchor (quote/prefix/suffix/start/end). Replies are rows with
-- `parent_id` pointing at the root — they share the root's anchor and
-- contribute only a `body`. Cascade delete drops every reply with its root.
--
-- Safe and idempotent: every change uses `if (not) exists` or guarded drops.
-- No data is removed.

-- Self-FK for the parent → child link.
alter table public.document_comments
	add column if not exists parent_id uuid
		references public.document_comments(id) on delete cascade;

create index if not exists document_comments_parent_idx
	on public.document_comments (parent_id);

-- Replies don't carry their own anchor. Drop NOT NULL on the anchor columns
-- so reply rows can leave them blank. The check constraint below restores
-- the requirement for thread roots (parent_id is null → anchor required).
alter table public.document_comments alter column anchor_quote drop not null;
alter table public.document_comments alter column anchor_start drop not null;
alter table public.document_comments alter column anchor_end drop not null;

alter table public.document_comments
	drop constraint if exists document_comments_anchor_required;
alter table public.document_comments
	add constraint document_comments_anchor_required
	check (
		parent_id is not null
		or (
			anchor_quote is not null
			and anchor_start is not null
			and anchor_end is not null
		)
	);

-- Reading and writing still flow through the existing RLS policies, which
-- key off document_id (every reply has the same document_id as its root).
-- The previous insert policy already forces created_by = auth.uid(), so
-- replies inherit author-attribution rules automatically.
--
-- Author-edit policy for body — let an author edit their own message.
drop policy if exists "document_comments_update" on public.document_comments;
create policy "document_comments_update"
	on public.document_comments for update
	using (created_by = auth.uid())
	with check (created_by = auth.uid());
