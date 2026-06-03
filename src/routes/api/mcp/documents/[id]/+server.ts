import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Database } from '$lib/database.types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { documentProjectForEditor } from '$lib/server/mcp-helpers';

/**
 * PATCH /api/mcp/documents/[id]
 *
 * Update a markdown document in place. Body: `{ content?: string, name?: string }`.
 * At least one of `content` or `name` must be present.
 *
 * Why a dedicated update endpoint (rather than re-using `upload_markdown`):
 * preserves document_id, project_id, position, created_at + all attached
 * comment threads. Re-uploading would create a duplicate doc and leave the
 * original threads orphaned on stale text.
 *
 * Anchors are intentionally NOT rewritten server-side. Comment anchor
 * offsets are stored as positions into the PLAIN-TEXT rendering of the
 * markdown (computed in the browser by walking the rendered DOM), not into
 * the raw markdown source. The frontend's `rangeFromAnchor` already handles
 * drift gracefully — it tries the stored offsets, falls back to a
 * prefix+quote+suffix indexOf, then a quote-only indexOf — and it operates
 * in the correct coordinate system. Re-implementing that server-side would
 * require running the markdown renderer here, which we don't want.
 *
 * Authorization: workspace editor or owner (same bar as upload_markdown).
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	await documentProjectForEditor(admin, locals.user.id, params.id);

	const raw: unknown = await request.json().catch(() => null);
	if (!raw || typeof raw !== 'object') {
		throw error(400, 'Invalid JSON body');
	}

	const hasContent = 'content' in raw && typeof raw.content === 'string';
	const hasName = 'name' in raw && typeof raw.name === 'string';
	if (!hasContent && !hasName) {
		throw error(400, 'Body must include `content` and/or `name`');
	}

	const body: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(raw)) {
		body[k] = v;
	}

	const update: Database['public']['Tables']['documents']['Update'] = {};
	if (hasContent) {
		update.content = typeof body.content === 'string' ? body.content : '';
	}
	if (hasName) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) {
			throw error(400, 'name cannot be empty');
		}
		if (name.length > 200) {
			throw error(400, 'name must be 200 characters or fewer');
		}
		update.name = name;
	}

	const { data: updated, error: updateErr } = await admin
		.from('documents')
		.update(update)
		.eq('id', params.id)
		.select('id, project_id, name, content, position, created_at, updated_at')
		.single();

	if (updateErr || !updated) {
		throw error(500, updateErr?.message ?? 'Could not update document');
	}

	return json({
		id: updated.id,
		project_id: updated.project_id,
		name: updated.name,
		content: updated.content,
		position: updated.position,
		created_at: updated.created_at,
		updated_at: updated.updated_at
	});
};
