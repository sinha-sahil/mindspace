import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * DELETE /api/api-tokens/[id] — revoke. RLS scopes deletion to the caller's
 * own tokens; API-token callers are blocked (UI flow only).
 */
export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	if (request.headers.get('authorization')?.startsWith('Bearer ')) {
		throw error(403, 'API tokens cannot revoke other tokens — use a browser session');
	}

	const { error: dbError } = await locals.supabase.from('api_tokens').delete().eq('id', params.id);
	if (dbError) {
		throw error(500, dbError.message);
	}
	return json({ ok: true });
};
