import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

/**
 * GET /api/mcp/workspaces — workspaces the caller can access (owned + shared).
 * Token-auth: locals.user is set by the api-token Bearer flow in hooks.server.ts.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	const userId = locals.user.id;

	const [{ data: owned, error: ownedErr }, { data: memberRows, error: memberErr }] =
		await Promise.all([
			admin
				.from('workspaces')
				.select('id, name, owner_id, created_at')
				.eq('owner_id', userId)
				.order('created_at', { ascending: true }),
			admin.from('workspace_members').select('workspace_id, role').eq('user_id', userId)
		]);

	if (ownedErr) {
		throw error(500, ownedErr.message);
	}
	if (memberErr) {
		throw error(500, memberErr.message);
	}

	const ownedIds = new Set((owned ?? []).map((w) => w.id));
	const memberIds = (memberRows ?? []).map((r) => r.workspace_id).filter((id) => !ownedIds.has(id));

	let shared: NonNullable<typeof owned> = [];
	if (memberIds.length > 0) {
		const { data, error: sharedErr } = await admin
			.from('workspaces')
			.select('id, name, owner_id, created_at')
			.in('id', memberIds);
		if (sharedErr) {
			throw error(500, sharedErr.message);
		}
		shared = data ?? [];
	}

	const workspaces = [
		...(owned ?? []).map((w) => ({
			id: w.id,
			name: w.name,
			role: 'owner' as const,
			created_at: w.created_at
		})),
		...shared.map((w) => {
			const m = memberRows?.find((r) => r.workspace_id === w.id);
			return {
				id: w.id,
				name: w.name,
				role: m?.role ?? 'viewer',
				created_at: w.created_at
			};
		})
	];

	return json({ workspaces });
};
