import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

/**
 * GET /api/app-members?q=foo
 *
 * Returns up to 20 allowlisted emails matching the (case-insensitive) query.
 * Used by the workspace-sharing user picker so a member can pick someone to
 * share with. Requires the caller to be an authenticated app member.
 *
 * The current user's own email is omitted from results.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const meEmail = (locals.user.email ?? '').toLowerCase();

	const admin = getSupabaseAdmin();
	let query = admin
		.from('app_members')
		.select('email')
		.order('email', { ascending: true })
		.limit(20);

	if (q.length > 0) {
		// Sanitize for ILIKE — escape Postgres LIKE special chars.
		const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
		query = query.ilike('email', `%${escaped}%`);
	}

	const { data, error: dbError } = await query;
	if (dbError) {
		throw error(500, dbError.message);
	}

	const emails = (data ?? [])
		.map((r) => r.email)
		.filter((e) => e.toLowerCase() !== meEmail);
	return json({ emails });
};
