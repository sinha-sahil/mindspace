import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

/**
 * POST /api/workspaces
 * body: { name: string }
 *
 * Create a workspace owned by the calling user. Runs through the admin
 * client so RLS is never the failure mode — the server has already
 * verified `locals.user` and `locals.isMember` upstream in authGuard.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}

	const body = await request.json().catch(() => null);
	const name = String((body as Record<string, unknown> | null)?.name ?? '').trim();
	if (!name) {
		throw error(400, 'Workspace name is required');
	}
	if (name.length > 80) {
		throw error(400, 'Workspace name must be 80 characters or fewer');
	}

	const admin = getSupabaseAdmin();
	const { data, error: dbError } = await admin
		.from('workspaces')
		.insert({ name, owner_id: locals.user.id })
		.select('id, name, owner_id, created_at')
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not create workspace');
	}

	return json(data);
};
