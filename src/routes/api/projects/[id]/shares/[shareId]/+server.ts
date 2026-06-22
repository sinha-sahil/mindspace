import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

async function assertCanManageShares(projectId: string, userId: string): Promise<void> {
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

	const { data: ws } = await admin
		.from('workspaces')
		.select('owner_id')
		.eq('id', project.workspace_id)
		.maybeSingle();
	if (ws?.owner_id === userId) {
		return;
	}

	const { data: member } = await admin
		.from('workspace_members')
		.select('role')
		.eq('workspace_id', project.workspace_id)
		.eq('user_id', userId)
		.maybeSingle();
	if (member?.role !== 'editor') {
		throw error(403, 'Only workspace editors can manage shares');
	}
}

/**
 * DELETE /api/projects/[id]/shares/[shareId]
 * Revoke a person's access to the project.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	await assertCanManageShares(params.id, locals.user.id);

	const admin = getSupabaseAdmin();
	const { error: delErr } = await admin
		.from('project_shares')
		.delete()
		.eq('id', params.shareId)
		.eq('project_id', params.id);
	if (delErr) {
		throw error(500, delErr.message);
	}

	return json({ ok: true });
};
