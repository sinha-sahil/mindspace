import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

type WorkspaceRole = 'editor' | 'viewer';

function assertRole(value: unknown): WorkspaceRole {
	if (value === 'editor' || value === 'viewer') {
		return value;
	}
	throw error(400, 'role must be "editor" or "viewer"');
}

async function assertWorkspaceOwner(
	workspaceId: string,
	userId: string,
	supabase: App.Locals['supabase']
): Promise<void> {
	const { data, error: dbError } = await supabase
		.from('workspaces')
		.select('owner_id')
		.eq('id', workspaceId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!data) {
		throw error(404, 'Workspace not found');
	}
	if (data.owner_id !== userId) {
		throw error(403, 'Only the workspace owner can manage members');
	}
}

/**
 * PATCH /api/workspaces/[id]/members/[userId]
 * body: { role: 'editor' | 'viewer' }
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	await assertWorkspaceOwner(params.id, locals.user.id, locals.supabase);

	const body: unknown = await request.json().catch(() => null);
	const rawRole = typeof body === 'object' && body !== null && 'role' in body ? body.role : null;
	const role = assertRole(rawRole);

	const admin = getSupabaseAdmin();
	const { error: dbError } = await admin
		.from('workspace_members')
		.update({ role })
		.eq('workspace_id', params.id)
		.eq('user_id', params.userId);
	if (dbError) {
		throw error(500, dbError.message);
	}
	return json({ ok: true });
};

/**
 * DELETE /api/workspaces/[id]/members/[userId]
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	await assertWorkspaceOwner(params.id, locals.user.id, locals.supabase);

	const admin = getSupabaseAdmin();
	const { error: dbError } = await admin
		.from('workspace_members')
		.delete()
		.eq('workspace_id', params.id)
		.eq('user_id', params.userId);
	if (dbError) {
		throw error(500, dbError.message);
	}
	return json({ ok: true });
};
