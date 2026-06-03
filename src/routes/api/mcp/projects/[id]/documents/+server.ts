import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { projectWorkspaceForReader, projectWorkspaceForEditor } from '$lib/server/mcp-helpers';

/**
 * GET /api/mcp/projects/[id]/documents — list markdown documents.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	await projectWorkspaceForReader(admin, locals.user.id, params.id);

	const { data, error: dbError } = await admin
		.from('documents')
		.select('id, project_id, name, content, position, created_at, updated_at')
		.eq('project_id', params.id)
		.order('position', { ascending: true })
		.order('created_at', { ascending: true });
	if (dbError) {
		throw error(500, dbError.message);
	}
	return json({ documents: data ?? [] });
};

/**
 * POST /api/mcp/projects/[id]/documents
 * body: { name: string, content?: string }
 *
 * Create a markdown document in a doc project. JSON-body variant for
 * programmatic upload (the cookie-path endpoint uses multipart).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const rawName = 'name' in body && typeof body.name === 'string' ? body.name.trim() : '';
	if (!rawName) {
		throw error(400, 'name is required');
	}
	const content = 'content' in body && typeof body.content === 'string' ? body.content : '';

	const admin = getSupabaseAdmin();
	const ctx = await projectWorkspaceForEditor(admin, locals.user.id, params.id);
	if (ctx.kind !== 'doc') {
		throw error(400, 'documents can only be uploaded to a project with kind="doc"');
	}

	const { data, error: dbError } = await admin
		.from('documents')
		.insert({
			project_id: params.id,
			name: rawName,
			content
		})
		.select('id, project_id, name, content, position, created_at, updated_at')
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not create document');
	}
	return json(data, { status: 201 });
};
