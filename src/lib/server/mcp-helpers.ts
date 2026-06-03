/**
 * Permission helpers used by the /api/mcp/* endpoints.
 *
 * MCP endpoints run with token-auth — `locals.user` is set, but
 * `locals.supabase` is the anon client (no session cookie to authenticate).
 * To access workspace-scoped data, MCP endpoints use the ADMIN client and
 * perform membership/editor/owner checks here explicitly (the same checks
 * RLS would have done on the cookie path).
 */
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

type Admin = SupabaseClient<Database>;

export async function userIsWorkspaceMember(
	admin: Admin,
	userId: string,
	workspaceId: string
): Promise<boolean> {
	const [owner, member] = await Promise.all([
		admin
			.from('workspaces')
			.select('id')
			.eq('id', workspaceId)
			.eq('owner_id', userId)
			.maybeSingle(),
		admin
			.from('workspace_members')
			.select('user_id')
			.eq('workspace_id', workspaceId)
			.eq('user_id', userId)
			.maybeSingle()
	]);
	return !!owner.data || !!member.data;
}

export async function userIsWorkspaceEditor(
	admin: Admin,
	userId: string,
	workspaceId: string
): Promise<boolean> {
	const [owner, member] = await Promise.all([
		admin
			.from('workspaces')
			.select('id')
			.eq('id', workspaceId)
			.eq('owner_id', userId)
			.maybeSingle(),
		admin
			.from('workspace_members')
			.select('role')
			.eq('workspace_id', workspaceId)
			.eq('user_id', userId)
			.maybeSingle()
	]);
	if (owner.data) {
		return true;
	}
	return member.data?.role === 'editor';
}

/**
 * Look up a project, ensure the user can READ it, return its workspace_id.
 * Throws 404 (project missing) or 403 (no access) with a helpful message.
 */
export async function projectWorkspaceForReader(
	admin: Admin,
	userId: string,
	projectId: string
): Promise<{ workspaceId: string; kind: string }> {
	const { data: project, error: dbError } = await admin
		.from('projects')
		.select('id, workspace_id, kind')
		.eq('id', projectId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!project) {
		throw error(404, 'Project not found');
	}
	const allowed = await userIsWorkspaceMember(admin, userId, project.workspace_id);
	if (!allowed) {
		throw error(403, 'You are not a member of this project’s workspace');
	}
	return { workspaceId: project.workspace_id, kind: project.kind };
}

/**
 * Same as projectWorkspaceForReader but requires editor (or owner) rights.
 */
export async function projectWorkspaceForEditor(
	admin: Admin,
	userId: string,
	projectId: string
): Promise<{ workspaceId: string; kind: string }> {
	const { data: project, error: dbError } = await admin
		.from('projects')
		.select('id, workspace_id, kind')
		.eq('id', projectId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!project) {
		throw error(404, 'Project not found');
	}
	const allowed = await userIsWorkspaceEditor(admin, userId, project.workspace_id);
	if (!allowed) {
		throw error(403, 'You need editor access to this project’s workspace');
	}
	return { workspaceId: project.workspace_id, kind: project.kind };
}

export async function documentProjectForReader(
	admin: Admin,
	userId: string,
	documentId: string
): Promise<{ projectId: string; workspaceId: string }> {
	const { data: doc, error: dbError } = await admin
		.from('documents')
		.select('id, project_id')
		.eq('id', documentId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!doc) {
		throw error(404, 'Document not found');
	}
	const ctx = await projectWorkspaceForReader(admin, userId, doc.project_id);
	return { projectId: doc.project_id, workspaceId: ctx.workspaceId };
}

/**
 * Same as documentProjectForReader but requires editor (or owner) rights —
 * used by mutating MCP endpoints (update_markdown, future delete, etc.).
 */
export async function documentProjectForEditor(
	admin: Admin,
	userId: string,
	documentId: string
): Promise<{ projectId: string; workspaceId: string }> {
	const { data: doc, error: dbError } = await admin
		.from('documents')
		.select('id, project_id')
		.eq('id', documentId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!doc) {
		throw error(404, 'Document not found');
	}
	const ctx = await projectWorkspaceForEditor(admin, userId, doc.project_id);
	return { projectId: doc.project_id, workspaceId: ctx.workspaceId };
}

/**
 * Look up a comment, ensure it's a THREAD ROOT (not a reply), confirm the
 * user is a workspace member (the same bar the cookie path uses for
 * commenting / resolving), and return the full context.
 *
 * Caller decides whether the action is a read (everyone-can-read by RLS
 * already) or a write (any member may reply / toggle resolved). Throws 404
 * for missing, 400 if `commentId` points at a reply, 403 for no access.
 */
export async function commentRootForMember(
	admin: Admin,
	userId: string,
	commentId: string
): Promise<{
	rootId: string;
	documentId: string;
	projectId: string;
	workspaceId: string;
	createdBy: string | null;
}> {
	const { data: comment, error: dbError } = await admin
		.from('document_comments')
		.select('id, document_id, parent_id, created_by')
		.eq('id', commentId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!comment) {
		throw error(404, 'Comment not found');
	}
	if (comment.parent_id) {
		throw error(
			400,
			'Resolve and reply act on the thread root — pass the root comment id, not a reply.'
		);
	}
	const ctx = await documentProjectForReader(admin, userId, comment.document_id);
	return {
		rootId: comment.id,
		documentId: comment.document_id,
		projectId: ctx.projectId,
		workspaceId: ctx.workspaceId,
		createdBy: comment.created_by
	};
}
