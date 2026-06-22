import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

/**
 * Per-project sharing with specific people.
 *
 * Grants are stored by email (lowercased) in project_shares so a project can
 * be shared before the recipient's first sign-in. Recipients view the project
 * at /p/<id> after authenticating; role is 'viewer' for now ('editor' is
 * reserved in the schema for when shared editing ships).
 */

type ProjectAccess = {
	workspaceId: string;
	/** Workspace owner or editor member — may manage shares. */
	canManage: boolean;
	/** Any workspace member — may list shares. */
	isMember: boolean;
};

async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess> {
	const admin = getSupabaseAdmin();

	const { data: project, error: projErr } = await admin
		.from('projects')
		.select('id, workspace_id')
		.eq('id', projectId)
		.maybeSingle();
	if (projErr) {
		throw error(500, projErr.message);
	}
	if (!project) {
		throw error(404, 'Project not found');
	}

	const { data: ws, error: wsErr } = await admin
		.from('workspaces')
		.select('owner_id')
		.eq('id', project.workspace_id)
		.maybeSingle();
	if (wsErr) {
		throw error(500, wsErr.message);
	}
	if (ws?.owner_id === userId) {
		return { workspaceId: project.workspace_id, canManage: true, isMember: true };
	}

	const { data: member } = await admin
		.from('workspace_members')
		.select('role')
		.eq('workspace_id', project.workspace_id)
		.eq('user_id', userId)
		.maybeSingle();

	return {
		workspaceId: project.workspace_id,
		canManage: member?.role === 'editor',
		isMember: member !== null
	};
}

/**
 * GET /api/projects/[id]/shares
 * List who this project is shared with. Any workspace member can look.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const access = await getProjectAccess(params.id, locals.user.id);
	if (!access.isMember) {
		throw error(404, 'Project not found');
	}

	const admin = getSupabaseAdmin();
	const { data: rows, error: dbError } = await admin
		.from('project_shares')
		.select('id, email, role, created_at')
		.eq('project_id', params.id)
		.order('created_at', { ascending: true });
	if (dbError) {
		throw error(500, dbError.message);
	}

	return json({
		shares: (rows ?? []).map((s) => ({
			id: s.id,
			email: s.email,
			role: s.role,
			createdAt: s.created_at
		}))
	});
};

/**
 * POST /api/projects/[id]/shares
 * body: { email: string }
 *
 * Share the project with a specific person (view access). Caller must be the
 * workspace owner or an editor member. The email must be on the platform
 * allowlist — people outside it can't sign in to view anyway.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const access = await getProjectAccess(params.id, locals.user.id);
	if (!access.isMember) {
		throw error(404, 'Project not found');
	}
	if (!access.canManage) {
		throw error(403, 'Only workspace editors can share this project');
	}

	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const rawEmail = 'email' in body ? body.email : '';
	const email = String(rawEmail ?? '')
		.trim()
		.toLowerCase();

	if (!email || !email.includes('@')) {
		throw error(400, 'Valid email required');
	}
	if (email === (locals.user.email ?? '').toLowerCase()) {
		throw error(400, "You can't share a project with yourself");
	}

	const admin = getSupabaseAdmin();

	const { data: allow } = await admin
		.from('app_members')
		.select('email')
		.eq('email', email)
		.maybeSingle();
	if (!allow) {
		throw error(400, "That email isn't on the platform allowlist yet.");
	}

	// Already shared? Return the existing grant instead of erroring.
	const { data: existing } = await admin
		.from('project_shares')
		.select('id, email, role, created_at')
		.eq('project_id', params.id)
		.eq('email', email)
		.maybeSingle();
	if (existing) {
		return json({
			share: {
				id: existing.id,
				email: existing.email,
				role: existing.role,
				createdAt: existing.created_at
			}
		});
	}

	const { data: inserted, error: insErr } = await admin
		.from('project_shares')
		.insert({
			project_id: params.id,
			email,
			role: 'viewer',
			added_by: locals.user.id
		})
		.select('id, email, role, created_at')
		.single();
	if (insErr || !inserted) {
		throw error(500, insErr?.message ?? 'Failed to share project');
	}

	return json({
		share: {
			id: inserted.id,
			email: inserted.email,
			role: inserted.role,
			createdAt: inserted.created_at
		}
	});
};
