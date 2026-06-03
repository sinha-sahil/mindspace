import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { commentRootForMember } from '$lib/server/mcp-helpers';

/**
 * POST /api/mcp/comments/[id]/replies
 *
 * Add a reply to the comment thread rooted at [id]. Body: `{ body: string }`.
 * Replies inherit the root's document + anchor; only `body` is meaningful.
 *
 * The caller must be a workspace member (same bar as the cookie UI uses
 * for posting comments — viewers commenting is the point of the feature).
 * If [id] points at a reply instead of a root, the helper throws 400 so
 * the LLM can correct itself rather than building deeper nesting.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	const root = await commentRootForMember(admin, locals.user.id, params.id);

	const raw: unknown = await request.json().catch(() => null);
	if (!raw || typeof raw !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const rawBody = 'body' in raw && typeof raw.body === 'string' ? raw.body.trim() : '';
	if (!rawBody) {
		throw error(400, 'body is required');
	}

	const { data, error: dbError } = await admin
		.from('document_comments')
		.insert({
			document_id: root.documentId,
			parent_id: root.rootId,
			body: rawBody,
			created_by: locals.user.id,
			anchor_quote: null,
			anchor_prefix: '',
			anchor_suffix: '',
			anchor_start: null,
			anchor_end: null
		})
		.select(
			'id, document_id, parent_id, body, anchor_quote, anchor_prefix, anchor_suffix, anchor_start, anchor_end, created_by, created_at, resolved_at, resolved_by'
		)
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not save reply');
	}

	// Author email — we just inserted as the calling user, so use their email
	// directly without another admin round-trip.
	const author_email = locals.user.email ?? '';

	return json(
		{
			id: data.id,
			document_id: data.document_id,
			parent_id: data.parent_id,
			body: data.body,
			anchor_quote: data.anchor_quote,
			anchor_prefix: data.anchor_prefix,
			anchor_suffix: data.anchor_suffix,
			anchor_start: data.anchor_start,
			anchor_end: data.anchor_end,
			created_by: data.created_by,
			created_at: data.created_at,
			author_email,
			resolved_at: data.resolved_at,
			resolved_by: data.resolved_by
		},
		{ status: 201 }
	);
};
