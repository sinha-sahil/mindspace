import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { projectWorkspaceForReader } from '$lib/server/mcp-helpers';

const SELECT_FIELDS =
	'id, document_id, parent_id, body, anchor_quote, anchor_prefix, anchor_suffix, anchor_start, anchor_end, created_by, created_at, resolved_at, resolved_by';

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

/**
 * GET /api/mcp/projects/[id]/comments
 *
 * Returns every comment on every document in the project — thread roots and
 * their replies — with author emails resolved. The LLM gets one round-trip
 * to triage all open conversations instead of paging document-by-document.
 *
 * Optional query params:
 *   - `state=open|resolved|all` — filter thread roots by resolution state
 *     (defaults to `all`). Replies always come along with their matching root.
 *   - `document_id=<uuid>` — narrow to a single document inside the project.
 *
 * The shape matches /api/mcp/documents/[id]/comments so MCP clients can
 * reuse the same parsing code. `document_id` is always populated so the
 * caller can group threads by file.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	await projectWorkspaceForReader(admin, locals.user.id, params.id);

	const stateRaw = url.searchParams.get('state');
	const state: 'open' | 'resolved' | 'all' =
		stateRaw === 'open' || stateRaw === 'resolved' ? stateRaw : 'all';
	const docFilter = url.searchParams.get('document_id');

	// Look up the project's document ids first so we can scope the comment
	// queries by `document_id in (...)` — comments don't carry project_id.
	let docQuery = admin.from('documents').select('id').eq('project_id', params.id);
	if (docFilter) {
		docQuery = docQuery.eq('id', docFilter);
	}
	const { data: docs, error: docErr } = await docQuery;
	if (docErr) {
		throw error(500, docErr.message);
	}
	const docIds = (docs ?? []).map((d) => d.id);
	if (docIds.length === 0) {
		return json({ comments: [] });
	}

	// Roots first (filtered by state), then their replies.
	let rootQuery = admin
		.from('document_comments')
		.select(SELECT_FIELDS)
		.in('document_id', docIds)
		.is('parent_id', null)
		.order('created_at', { ascending: false });

	if (state === 'open') {
		rootQuery = rootQuery.is('resolved_at', null);
	} else if (state === 'resolved') {
		rootQuery = rootQuery.not('resolved_at', 'is', null);
	}

	const { data: roots, error: rootErr } = await rootQuery;
	if (rootErr) {
		throw error(500, rootErr.message);
	}
	const rootRows: Row[] = roots ?? [];
	const rootIds = rootRows.map((r) => r.id);

	let replyRows: Row[] = [];
	if (rootIds.length > 0) {
		const { data: replies, error: replyErr } = await admin
			.from('document_comments')
			.select(SELECT_FIELDS)
			.in('document_id', docIds)
			.in('parent_id', rootIds)
			.order('created_at', { ascending: true });
		if (replyErr) {
			throw error(500, replyErr.message);
		}
		replyRows = replies ?? [];
	}

	const all: Row[] = [...rootRows, ...replyRows];

	// Resolve author + resolver emails in one pass per user.
	const userIds = Array.from(
		new Set(
			all.flatMap((r) => [
				...(r.created_by ? [r.created_by] : []),
				...(r.resolved_by ? [r.resolved_by] : [])
			])
		)
	);
	const emails = new Map<string, string>();
	if (userIds.length > 0) {
		await Promise.all(
			userIds.map(async (uid) => {
				const { data } = await admin.auth.admin.getUserById(uid);
				emails.set(uid, data.user?.email ?? '');
			})
		);
	}

	const comments = all.map((r) => ({
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

	return json({ comments, project_id: params.id });
};
