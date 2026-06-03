import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { documentProjectForReader } from '$lib/server/mcp-helpers';

const SELECT_FIELDS =
	'id, document_id, parent_id, body, anchor_quote, anchor_prefix, anchor_suffix, anchor_start, anchor_end, created_by, created_at, resolved_at, resolved_by';

function parseInt10(raw: string | null): number | null {
	if (raw === null) {
		return null;
	}
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/mcp/documents/[id]/comments
 *
 * Returns thread roots + replies for the document, with author emails
 * resolved via the admin client. Filter rules:
 *   - if `start` and `end` query params are given, returns thread roots
 *     whose anchor range overlaps [start, end] (the "fetch by selection"
 *     case), plus their replies.
 *   - else if `quote` is given, returns thread roots whose anchor_quote
 *     matches exactly, plus their replies.
 *   - else returns every comment on the document.
 *
 * If both `start`/`end` and `quote` are given, range overlap applies with
 * quote as an additional AND on the root.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	await documentProjectForReader(admin, locals.user.id, params.id);

	const quote = url.searchParams.get('quote');
	const start = parseInt10(url.searchParams.get('start'));
	const end = parseInt10(url.searchParams.get('end'));
	const filtering = (start !== null && end !== null) || quote !== null;

	type Row = {
		id: string;
		document_id: string;
		parent_id: string | null;
		body: string;
		anchor_quote: string | null;
		anchor_prefix: string;
		anchor_suffix: string;
		anchor_start: number | null;
		anchor_end: number | null;
		created_by: string | null;
		created_at: string;
		resolved_at: string | null;
		resolved_by: string | null;
	};
	let rows: Row[];

	if (filtering) {
		let rootQuery = admin
			.from('document_comments')
			.select(SELECT_FIELDS)
			.eq('document_id', params.id)
			.is('parent_id', null)
			.order('created_at', { ascending: false });

		if (start !== null && end !== null) {
			rootQuery = rootQuery.lte('anchor_start', end).gte('anchor_end', start);
		}
		if (quote) {
			rootQuery = rootQuery.eq('anchor_quote', quote);
		}

		const { data: roots, error: rootErr } = await rootQuery;
		if (rootErr) {
			throw error(500, rootErr.message);
		}
		const rootIds = (roots ?? []).map((r) => r.id);
		rows = roots ?? [];
		if (rootIds.length > 0) {
			const { data: replies, error: replyErr } = await admin
				.from('document_comments')
				.select(SELECT_FIELDS)
				.eq('document_id', params.id)
				.in('parent_id', rootIds)
				.order('created_at', { ascending: true });
			if (replyErr) {
				throw error(500, replyErr.message);
			}
			rows = [...rows, ...(replies ?? [])];
		}
	} else {
		const { data, error: dbError } = await admin
			.from('document_comments')
			.select(SELECT_FIELDS)
			.eq('document_id', params.id)
			.order('created_at', { ascending: false });
		if (dbError) {
			throw error(500, dbError.message);
		}
		rows = data ?? [];
	}

	// Resolve author + resolver emails — same pattern as the cookie-auth
	// endpoint, expanded to include resolved_by so the LLM sees who closed
	// each thread.
	const ids = Array.from(
		new Set(
			rows.flatMap((r) => [
				...(r.created_by ? [r.created_by] : []),
				...(r.resolved_by ? [r.resolved_by] : [])
			])
		)
	);
	const emails = new Map<string, string>();
	if (ids.length > 0) {
		await Promise.all(
			ids.map(async (id) => {
				const { data } = await admin.auth.admin.getUserById(id);
				emails.set(id, data.user?.email ?? '');
			})
		);
	}

	const comments = rows.map((r) => ({
		id: r.id,
		document_id: r.document_id,
		parent_id: r.parent_id,
		body: r.body,
		anchor_quote: r.anchor_quote,
		anchor_prefix: r.anchor_prefix,
		anchor_suffix: r.anchor_suffix,
		anchor_start: r.anchor_start,
		anchor_end: r.anchor_end,
		created_by: r.created_by,
		created_at: r.created_at,
		author_email: r.created_by ? (emails.get(r.created_by) ?? '') : '',
		resolved_at: r.resolved_at,
		resolved_by: r.resolved_by,
		resolved_by_email: r.resolved_by ? (emails.get(r.resolved_by) ?? '') : ''
	}));

	return json({ comments });
};
