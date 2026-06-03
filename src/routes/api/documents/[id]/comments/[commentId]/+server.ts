import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * DELETE /api/documents/[id]/comments/[commentId]
 *
 * RLS allows the comment's author or the workspace owner to delete.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const { error: dbError } = await locals.supabase
		.from('document_comments')
		.delete()
		.eq('id', params.commentId)
		.eq('document_id', params.id);

	if (dbError) {
		throw error(500, dbError.message);
	}

	return json({ ok: true });
};
