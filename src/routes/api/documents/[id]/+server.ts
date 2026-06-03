import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/documents/[id]
 *
 * Read a single markdown document. RLS gates access to workspace members.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const { data, error: dbError } = await locals.supabase
		.from('documents')
		.select('id, project_id, name, content, position, created_at, updated_at')
		.eq('id', params.id)
		.maybeSingle();

	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!data) {
		throw error(404, 'Document not found');
	}

	return json(data);
};

/**
 * PATCH /api/documents/[id]
 * body: { name?: string, content?: string }
 *
 * Update the markdown content or filename. RLS requires editor access.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}

	const update: { name?: string; content?: string } = {};
	if ('name' in body && typeof body.name === 'string') {
		const trimmed = body.name.trim();
		if (!trimmed) {
			throw error(400, 'name cannot be empty');
		}
		update.name = trimmed;
	}
	if ('content' in body && typeof body.content === 'string') {
		update.content = body.content;
	}
	if (Object.keys(update).length === 0) {
		throw error(400, 'Nothing to update — pass name and/or content');
	}

	const { data, error: dbError } = await locals.supabase
		.from('documents')
		.update(update)
		.eq('id', params.id)
		.select('id, project_id, name, content, position, created_at, updated_at')
		.maybeSingle();

	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!data) {
		throw error(404, 'Document not found');
	}

	return json(data);
};

/**
 * DELETE /api/documents/[id]
 *
 * Remove a document (cascades to its comments). RLS requires editor access.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const { error: dbError } = await locals.supabase.from('documents').delete().eq('id', params.id);

	if (dbError) {
		throw error(500, dbError.message);
	}

	return json({ ok: true });
};
