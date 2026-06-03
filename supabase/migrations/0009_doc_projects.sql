-- mindspace: doc projects + markdown documents + text-anchored comments.
-- Run after 0008_drop_is_app_member_from_rls.sql.
--
-- A "doc project" is a project (kind='doc') that holds a collection of
-- markdown documents. Comments are anchored to text selections within a
-- document using the W3C Web Annotation TextQuoteSelector + TextPositionSelector
-- shape (quote + prefix/suffix + start/end), which keeps anchors stable across
-- edits and lets us query by either quote or character range.

-- =============================================================
-- projects.kind  ('whiteboard' | 'doc')
-- Existing rows are whiteboards.
-- =============================================================
alter table public.projects
	add column if not exists kind text not null default 'whiteboard'
		check (kind in ('whiteboard', 'doc'));

create index if not exists projects_workspace_kind_idx
	on public.projects (workspace_id, kind);

-- =============================================================
-- documents — markdown files inside a doc project.
-- =============================================================
create table if not exists public.documents (
	id uuid primary key default gen_random_uuid(),
	project_id uuid not null references public.projects(id) on delete cascade,
	name text not null,
	content text not null default '',
	position int not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists documents_project_idx
	on public.documents (project_id, position, created_at);

create or replace function public.touch_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
	before update on public.documents
	for each row
	execute function public.touch_documents_updated_at();

alter table public.documents enable row level security;

-- A workspace member of the document's parent project's workspace can read.
drop policy if exists "documents_select" on public.documents;
create policy "documents_select"
	on public.documents for select
	using (
		exists (
			select 1 from public.projects p
			where p.id = documents.project_id
				and public.is_workspace_member(p.workspace_id)
		)
	);

-- Editor (or owner) of the parent workspace can insert/update/delete.
drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert"
	on public.documents for insert
	with check (
		exists (
			select 1 from public.projects p
			where p.id = documents.project_id
				and public.is_workspace_editor(p.workspace_id)
		)
	);

drop policy if exists "documents_update" on public.documents;
create policy "documents_update"
	on public.documents for update
	using (
		exists (
			select 1 from public.projects p
			where p.id = documents.project_id
				and public.is_workspace_editor(p.workspace_id)
		)
	)
	with check (
		exists (
			select 1 from public.projects p
			where p.id = documents.project_id
				and public.is_workspace_editor(p.workspace_id)
		)
	);

drop policy if exists "documents_delete" on public.documents;
create policy "documents_delete"
	on public.documents for delete
	using (
		exists (
			select 1 from public.projects p
			where p.id = documents.project_id
				and public.is_workspace_editor(p.workspace_id)
		)
	);

-- =============================================================
-- document_comments — text-anchored comments on a document.
--   anchor_quote  : the selected text (the W3C "exact" selector)
--   anchor_prefix : a few chars immediately before (disambiguation)
--   anchor_suffix : a few chars immediately after  (disambiguation)
--   anchor_start  : character offset in the plain-text rendering
--   anchor_end    : character offset (end, exclusive)
-- The pair of selectors (quote + position) means the comment endpoint
-- can match by quote, by range overlap, or by both.
-- =============================================================
create table if not exists public.document_comments (
	id uuid primary key default gen_random_uuid(),
	document_id uuid not null references public.documents(id) on delete cascade,
	body text not null,
	anchor_quote text not null,
	anchor_prefix text not null default '',
	anchor_suffix text not null default '',
	anchor_start int not null,
	anchor_end int not null check (anchor_end >= anchor_start),
	created_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now()
);

create index if not exists document_comments_document_idx
	on public.document_comments (document_id, created_at desc);

create index if not exists document_comments_range_idx
	on public.document_comments (document_id, anchor_start, anchor_end);

create index if not exists document_comments_quote_idx
	on public.document_comments (document_id, anchor_quote);

alter table public.document_comments enable row level security;

-- Anyone with workspace access to the document's project can read comments.
drop policy if exists "document_comments_select" on public.document_comments;
create policy "document_comments_select"
	on public.document_comments for select
	using (
		exists (
			select 1
			from public.documents d
			join public.projects p on p.id = d.project_id
			where d.id = document_comments.document_id
				and public.is_workspace_member(p.workspace_id)
		)
	);

-- Workspace members (incl. viewers) can add comments, but only on their own
-- behalf. Editors aren't required — viewers commenting is the point.
drop policy if exists "document_comments_insert" on public.document_comments;
create policy "document_comments_insert"
	on public.document_comments for insert
	with check (
		auth.uid() is not null
		and created_by = auth.uid()
		and exists (
			select 1
			from public.documents d
			join public.projects p on p.id = d.project_id
			where d.id = document_comments.document_id
				and public.is_workspace_member(p.workspace_id)
		)
	);

-- Authors can delete their own comments. Workspace owners can delete any.
drop policy if exists "document_comments_delete" on public.document_comments;
create policy "document_comments_delete"
	on public.document_comments for delete
	using (
		created_by = auth.uid()
		or exists (
			select 1
			from public.documents d
			join public.projects p on p.id = d.project_id
			where d.id = document_comments.document_id
				and public.is_workspace_owner(p.workspace_id)
		)
	);
