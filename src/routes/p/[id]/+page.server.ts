import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ params, locals }) => {
	const admin = getSupabaseAdmin();

	const { data: project, error: dbError } = await admin
		.from('projects')
		.select('id, name, scene, visibility, workspace_id, updated_at')
		.eq('id', params.id)
		.maybeSingle();

	if (dbError) {throw error(500, dbError.message);}
	if (!project) {throw error(404, 'Project not found');}

	// Determine read/edit:
	//   - public link: read-only for everyone
	//   - private: only the workspace owner can view (and they edit at /)
	let canView = false;
	let isOwner = false;

	if (project.visibility === 'link') {
		canView = true;
	}

	if (locals.user) {
		const { data: ws } = await admin
			.from('workspaces')
			.select('owner_id')
			.eq('id', project.workspace_id)
			.maybeSingle();
		if (ws?.owner_id === locals.user.id) {
			canView = true;
			isOwner = true;
		}
	}

	if (!canView) {throw error(404, 'Project not found');}

	return {
		project: {
			id: project.id,
			name: project.name,
			scene: project.scene ? JSON.stringify(project.scene) : '',
			visibility: project.visibility,
			updatedAt: new Date(project.updated_at).getTime()
		},
		isOwner
	};
};
