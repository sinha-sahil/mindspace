import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { DocumentRow } from '$lib/database.types';

/**
 * GET /api/projects/[projectId]/documents
 *
 * List markdown documents in a doc project. RLS handles access: the user
 * must be a member of the project's workspace.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const { data, error: dbError } = await locals.supabase
		.from('documents')
		.select('id, project_id, name, content, position, created_at, updated_at')
		.eq('project_id', params.projectId)
		.order('position', { ascending: true })
		.order('created_at', { ascending: true });

	if (dbError) {
		throw error(500, dbError.message);
	}

	return json({ documents: data ?? [] });
};

/**
 * POST /api/projects/[projectId]/documents
 *
 * Upload a markdown file as a new document. Content-Type: multipart/form-data,
 * with a `file` field carrying the .md content. The filename is used as the
 * document name (the caller may pass a `name` field to override).
 *
 * RLS handles authorization: the user must be a workspace editor for the
 * project's workspace.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		throw error(400, 'Expected multipart/form-data');
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		throw error(400, '`file` field is required and must be a file');
	}

	const explicitName = formData.get('name');
	const name =
		(typeof explicitName === 'string' && explicitName.trim()) || file.name || 'untitled.md';

	const content = await file.text();

	const { data, error: dbError } = await locals.supabase
		.from('documents')
		.insert({
			project_id: params.projectId,
			name: name.trim(),
			content
		})
		.select('id, project_id, name, content, position, created_at, updated_at')
		.single<DocumentRow>();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not create document');
	}

	return json(data, { status: 201 });
};
