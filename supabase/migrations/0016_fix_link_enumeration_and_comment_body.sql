-- mindspace: stop anonymous enumeration of link-shared projects.
--
-- SECURITY FIX. The 0010_project_shares policy `projects_link_public_select`
-- grants the anon role SELECT on every row where visibility='link'. Because the
-- anon key ships in the client bundle, anyone can call the PostgREST endpoint
--   GET /rest/v1/projects?visibility=eq.link
-- and enumerate EVERY link-shared project across all users — names + full
-- `scene` (whiteboard/sheet content) — and then read each one's document bodies
-- via the /p/<id> page. A "share link" is meant to be an unguessable capability
-- URL, not a publicly listable set.
--
-- The fix: remove the anon-facing policy entirely. Link viewing does NOT depend
-- on it — src/routes/p/[id]/+page.server.ts loads the project with the
-- service-role (admin) client and performs its own visibility/expiry/membership
-- /share check server-side. So dropping this policy closes the enumeration hole
-- without breaking any legitimate share link.
--
-- After this migration the `projects` table has no anon-readable policy; the
-- only SELECT paths left are the authenticated member/share policies from
-- 0006/0008/0010, all keyed on auth.uid().

drop policy if exists "projects_link_public_select" on public.projects;

-- The matching document policy for shared *people* (has_project_share) stays;
-- it requires an authenticated email claim and is not anon-enumerable. The
-- 0004-era anon documents policy never existed, so nothing to drop there.

-- =============================================================
-- Harden document_comments: members may toggle resolution, but only the
-- author may change the comment BODY.
--
-- 0012_comment_resolution widened the UPDATE policy to "author OR any
-- workspace member" so members could resolve/reopen threads. RLS can't scope
-- an UPDATE to specific columns, so that same policy also lets any member
-- rewrite another member's comment text via a direct PostgREST call. The API
-- layer isn't in the path for browser clients (they hold the anon key and hit
-- the DB directly), so we enforce the column-level rule with a trigger.
--
-- Rule: if `body` changes and the editor is not the original author, reject.
-- Resolution columns (resolved_at, resolved_by) and everything else stay
-- editable by any member the RLS policy already admitted.
-- =============================================================
create or replace function public.enforce_comment_body_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.body is distinct from old.body and old.created_by is distinct from auth.uid() then
		raise exception 'Only the author may edit a comment body'
			using errcode = 'check_violation';
	end if;
	return new;
end;
$$;

drop trigger if exists document_comments_body_author_guard on public.document_comments;
create trigger document_comments_body_author_guard
	before update on public.document_comments
	for each row execute function public.enforce_comment_body_author();
