import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { userIsWorkspaceMember } from '$lib/server/mcp-helpers';

/**
 * GET /api/mcp/workspaces/[id]/projects?kind=whiteboard|doc
 *
 * List projects in a workspace the caller can read. Optional `kind` filter.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	const allowed = await userIsWorkspaceMember(admin, locals.user.id, params.id);
	if (!allowed) {
		throw error(403, 'You are not a member of this workspace');
	}

	const kind = url.searchParams.get('kind');
	let query = admin
		.from('projects')
		.select('id, workspace_id, name, kind, visibility, position, created_at, updated_at')
		.eq('workspace_id', params.id)
		.order('position', { ascending: true })
		.order('created_at', { ascending: false });
	if (kind === 'whiteboard' || kind === 'doc' || kind === 'todo' || kind === 'sheet') {
		query = query.eq('kind', kind);
	}

	const { data, error: dbError } = await query;
	if (dbError) {
		throw error(500, dbError.message);
	}
	return json({ projects: data ?? [] });
};
