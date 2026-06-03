import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { commentRootForMember } from '$lib/server/mcp-helpers';

/**
 * POST /api/mcp/comments/[id]/resolve
 *
 * Toggle resolution state on a thread root. Body: `{ resolved?: boolean }`
 * (defaults to `true`). Setting `resolved: false` reopens the thread.
 *
 * Resolution lives only on the root row; replies inherit by definition.
 * Any workspace member can resolve / reopen (matches the "viewer can
 * comment" precedent — the action is collaborative, not editorial).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	const root = await commentRootForMember(admin, locals.user.id, params.id);

	// Empty body is allowed — defaults to resolved=true.
	const raw: unknown = await request.json().catch(() => ({}));
	let resolved = true;
	if (raw && typeof raw === 'object' && 'resolved' in raw) {
		if (typeof raw.resolved !== 'boolean') {
			throw error(400, '`resolved` must be a boolean');
		}
		resolved = raw.resolved;
	}

	const patch = resolved
		? { resolved_at: new Date().toISOString(), resolved_by: locals.user.id }
		: { resolved_at: null, resolved_by: null };

	const { data, error: dbError } = await admin
		.from('document_comments')
		.update(patch)
		.eq('id', root.rootId)
		.select('id, document_id, body, resolved_at, resolved_by')
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not update comment');
	}

	return json({
		id: data.id,
		document_id: data.document_id,
		body: data.body,
		resolved_at: data.resolved_at,
		resolved_by: data.resolved_by,
		resolved: !!data.resolved_at
	});
};
