import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ params, locals }) => {
	const admin = getSupabaseAdmin();

	const { data: project, error: dbError } = await admin
		.from('projects')
		.select('id, name, kind, scene, visibility, link_expires_at, workspace_id, updated_at')
		.eq('id', params.id)
		.maybeSingle();

	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!project) {
		throw error(404, 'Project not found');
	}

	// Access, in priority order:
	//   1. Workspace members — full access, edit happens at /.
	//   2. People the project was shared with (project_shares, by email).
	//   3. Public link — read-only for everyone, but only while unexpired.
	let canView = false;
	let isWorkspaceMember = false;
	let sharedWithYou = false;

	const linkExpiresAt = project.link_expires_at
		? new Date(project.link_expires_at).getTime()
		: null;
	const linkValid =
		project.visibility === 'link' && (linkExpiresAt === null || linkExpiresAt > Date.now());
	if (linkValid) {
		canView = true;
	}

	if (locals.user) {
		const { data: ws } = await admin
			.from('workspaces')
			.select('owner_id')
			.eq('id', project.workspace_id)
			.maybeSingle();
		if (ws?.owner_id === locals.user.id) {
			isWorkspaceMember = true;
		} else {
			const { data: member } = await admin
				.from('workspace_members')
				.select('user_id')
				.eq('workspace_id', project.workspace_id)
				.eq('user_id', locals.user.id)
				.maybeSingle();
			isWorkspaceMember = member !== null;
		}

		const email = (locals.user.email ?? '').toLowerCase();
		if (!isWorkspaceMember && email) {
			const { data: share } = await admin
				.from('project_shares')
				.select('id')
				.eq('project_id', project.id)
				.eq('email', email)
				.maybeSingle();
			sharedWithYou = share !== null;
		}

		if (isWorkspaceMember || sharedWithYou) {
			canView = true;
		}
	}

	if (!canView) {
		throw error(404, 'Project not found');
	}

	// Doc projects: ship the documents for the read-only viewer.
	let documents: { id: string; name: string; content: string }[] = [];
	if (project.kind === 'doc') {
		const { data: docs, error: docsErr } = await admin
			.from('documents')
			.select('id, name, content, position, created_at')
			.eq('project_id', project.id)
			.order('position', { ascending: true })
			.order('created_at', { ascending: true });
		if (docsErr) {
			throw error(500, docsErr.message);
		}
		documents = (docs ?? []).map((d) => ({ id: d.id, name: d.name, content: d.content }));
	}

	return {
		project: {
			id: project.id,
			name: project.name,
			kind: project.kind,
			scene: project.scene ? JSON.stringify(project.scene) : '',
			visibility: project.visibility,
			updatedAt: new Date(project.updated_at).getTime()
		},
		documents,
		isOwner: isWorkspaceMember,
		sharedWithYou
	};
};
