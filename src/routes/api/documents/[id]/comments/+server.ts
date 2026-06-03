import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Database } from '$lib/database.types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

type CommentAnchor = {
	anchor_quote: string;
	anchor_prefix: string;
	anchor_suffix: string;
	anchor_start: number;
	anchor_end: number;
};

type ParsedCommentBody = {
	body: string;
	parentId: string | null;
	anchor: CommentAnchor | null;
};

function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseInt10(raw: string | null): number | null {
	if (raw === null) {
		return null;
	}
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : null;
}

function parseAnchor(input: object): CommentAnchor {
	const quote = 'anchor_quote' in input ? asString(input.anchor_quote) : null;
	if (!quote) {
		throw error(400, 'anchor_quote is required for a new thread');
	}
	const start = 'anchor_start' in input ? asFiniteNumber(input.anchor_start) : null;
	const end = 'anchor_end' in input ? asFiniteNumber(input.anchor_end) : null;
	if (start === null || end === null) {
		throw error(400, 'anchor_start and anchor_end must be numbers');
	}
	if (end < start) {
		throw error(400, 'anchor_end must be >= anchor_start');
	}
	const rawPrefix = 'anchor_prefix' in input ? asString(input.anchor_prefix) : null;
	const rawSuffix = 'anchor_suffix' in input ? asString(input.anchor_suffix) : null;
	return {
		anchor_quote: quote,
		anchor_prefix: rawPrefix ?? '',
		anchor_suffix: rawSuffix ?? '',
		anchor_start: start,
		anchor_end: end
	};
}

function parseCommentBody(input: unknown): ParsedCommentBody {
	if (!input || typeof input !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const rawBody = 'body' in input ? asString(input.body) : null;
	const text = rawBody ? rawBody.trim() : '';
	if (!text) {
		throw error(400, 'body is required');
	}
	const parentId = 'parent_id' in input ? asString(input.parent_id) : null;
	const anchor = parentId ? null : parseAnchor(input);
	return { body: text, parentId, anchor };
}

type CommentResponse = {
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
	author_email: string;
};

type CommentRow = {
	id: string;
	document_id: string;
	parent_id?: string | null;
	body: string;
	anchor_quote?: string | null;
	anchor_prefix: string;
	anchor_suffix: string;
	anchor_start?: number | null;
	anchor_end?: number | null;
	created_by: string | null;
	created_at: string;
};

/**
 * Resolve author emails for a batch of comment rows in one round-trip per
 * user. `auth.users` isn't readable via RLS, so we go through the admin
 * client (service-role key).
 */
async function resolveAuthorEmails(rows: CommentRow[]): Promise<Map<string, string>> {
	// flatMap with a ternary narrows away nulls without a type predicate.
	const ids = Array.from(new Set(rows.flatMap((r) => (r.created_by ? [r.created_by] : []))));
	const emails = new Map<string, string>();
	if (ids.length === 0) {
		return emails;
	}
	const admin = getSupabaseAdmin();
	await Promise.all(
		ids.map(async (id) => {
			const { data } = await admin.auth.admin.getUserById(id);
			emails.set(id, data.user?.email ?? '');
		})
	);
	return emails;
}

function toResponse(row: CommentRow, emails: Map<string, string>): CommentResponse {
	return {
		id: row.id,
		document_id: row.document_id,
		parent_id: row.parent_id ?? null,
		body: row.body,
		anchor_quote: row.anchor_quote ?? null,
		anchor_prefix: row.anchor_prefix,
		anchor_suffix: row.anchor_suffix,
		anchor_start: row.anchor_start ?? null,
		anchor_end: row.anchor_end ?? null,
		created_by: row.created_by,
		created_at: row.created_at,
		author_email: row.created_by ? (emails.get(row.created_by) ?? '') : ''
	};
}

const SELECT_FIELDS =
	'id, document_id, parent_id, body, anchor_quote, anchor_prefix, anchor_suffix, anchor_start, anchor_end, created_by, created_at';

/**
 * GET /api/documents/[id]/comments
 *
 * Returns all comments for the document (both thread roots and replies),
 * with author emails resolved. Frontend groups by parent_id.
 *
 * Filter rules (apply to thread ROOTS only — replies for matching roots
 * always come along):
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

	const quote = url.searchParams.get('quote');
	const start = parseInt10(url.searchParams.get('start'));
	const end = parseInt10(url.searchParams.get('end'));

	const filtering = (start !== null && end !== null) || quote !== null;

	if (filtering) {
		// Match roots first, then pull their replies.
		let rootQuery = locals.supabase
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
		let replies: CommentRow[] = [];
		if (rootIds.length > 0) {
			const { data: replyRows, error: replyErr } = await locals.supabase
				.from('document_comments')
				.select(SELECT_FIELDS)
				.eq('document_id', params.id)
				.in('parent_id', rootIds)
				.order('created_at', { ascending: true });
			if (replyErr) {
				throw error(500, replyErr.message);
			}
			replies = replyRows ?? [];
		}
		const all = [...(roots ?? []), ...replies];
		const emails = await resolveAuthorEmails(all);
		return json({ comments: all.map((r) => toResponse(r, emails)) });
	}

	// No filter — return everything on the document.
	const { data, error: dbError } = await locals.supabase
		.from('document_comments')
		.select(SELECT_FIELDS)
		.eq('document_id', params.id)
		.order('created_at', { ascending: false });
	if (dbError) {
		throw error(500, dbError.message);
	}
	const rows = data ?? [];
	const emails = await resolveAuthorEmails(rows);
	return json({ comments: rows.map((r) => toResponse(r, emails)) });
};

/**
 * POST /api/documents/[id]/comments
 *
 * Two shapes:
 *   - Thread root: `{ body, anchor_quote, anchor_prefix?, anchor_suffix?,
 *                     anchor_start, anchor_end }`
 *   - Reply:       `{ body, parent_id }`
 *
 * For a reply, the parent_id is validated to live on the same document
 * (avoids creating cross-document phantom threads).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const raw: unknown = await request.json().catch(() => null);
	const parsed = parseCommentBody(raw);

	if (parsed.parentId) {
		// Confirm parent lives on this document (RLS already gates access).
		const { data: parentRow, error: parentErr } = await locals.supabase
			.from('document_comments')
			.select('id, document_id, parent_id')
			.eq('id', parsed.parentId)
			.maybeSingle();
		if (parentErr) {
			throw error(500, parentErr.message);
		}
		if (!parentRow) {
			throw error(404, 'Parent comment not found');
		}
		if (parentRow.document_id !== params.id) {
			throw error(400, 'Parent comment is on a different document');
		}
		if (parentRow.parent_id) {
			throw error(400, 'Cannot reply to a reply — replies thread under the root');
		}
	}

	const insert: Database['public']['Tables']['document_comments']['Insert'] = {
		document_id: params.id,
		parent_id: parsed.parentId,
		body: parsed.body,
		created_by: locals.user.id,
		...(parsed.anchor
			? parsed.anchor
			: {
					anchor_quote: null,
					anchor_prefix: '',
					anchor_suffix: '',
					anchor_start: null,
					anchor_end: null
				})
	};

	const { data, error: dbError } = await locals.supabase
		.from('document_comments')
		.insert(insert)
		.select(SELECT_FIELDS)
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not save comment');
	}

	const emails = await resolveAuthorEmails([data]);
	return json(toResponse(data, emails), { status: 201 });
};
