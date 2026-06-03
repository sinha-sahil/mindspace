-- mindspace: add resolution state to document_comments.
-- Run after 0011_api_tokens.sql.
--
-- A thread can be marked "resolved" when the conversation is settled.
-- Resolution lives on the thread ROOT row only (parent_id is null) — every
-- reply implicitly inherits its root's state. We don't enforce the
-- parent-is-null constraint here because legacy rows pre-thread had no
-- parent_id, and the resolved_* columns being null on reply rows is fine.
--
-- Two columns:
--   resolved_at  — timestamp the thread was last marked resolved (null = open).
--   resolved_by  — uuid of the workspace member who resolved it.
--
-- "Reopen" = set both back to null. The API surfaces this as a single
-- POST /api/mcp/comments/[id]/resolve with `{ resolved: false }` body.
--
-- Existing comments are open by default (both columns null).
-- Safe and idempotent: every change uses `if (not) exists` / guarded drops.

alter table public.document_comments
	add column if not exists resolved_at timestamptz;

alter table public.document_comments
	add column if not exists resolved_by uuid
		references auth.users(id) on delete set null;

create index if not exists document_comments_unresolved_idx
	on public.document_comments (document_id)
	where parent_id is null and resolved_at is null;

-- Any workspace member can toggle resolved state on a thread root they can
-- read. The existing UPDATE policy (added in 0010) restricts to the author —
-- we widen it to "any workspace member" for the resolved_* columns only by
-- replacing the policy. Body edits still require authorship (enforced in
-- the API layer, since RLS can't express "you may set columns X+Y but not Z").
drop policy if exists "document_comments_update" on public.document_comments;
create policy "document_comments_update"
	on public.document_comments for update
	using (
		created_by = auth.uid()
		or exists (
			select 1
			from public.documents d
			join public.projects p on p.id = d.project_id
			where d.id = document_comments.document_id
				and public.is_workspace_member(p.workspace_id)
		)
	)
	with check (
		created_by = auth.uid()
		or exists (
			select 1
			from public.documents d
			join public.projects p on p.id = d.project_id
			where d.id = document_comments.document_id
				and public.is_workspace_member(p.workspace_id)
		)
	);
