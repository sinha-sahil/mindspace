import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

type WorkspaceRole = 'editor' | 'viewer';

function assertRole(value: unknown): WorkspaceRole {
	if (value === 'editor' || value === 'viewer') {
		return value;
	}
	throw error(400, 'role must be "editor" or "viewer"');
}

async function assertWorkspaceOwner(
	workspaceId: string,
	userId: string,
	supabase: App.Locals['supabase']
): Promise<void> {
	const { data, error: dbError } = await supabase
		.from('workspaces')
		.select('owner_id')
		.eq('id', workspaceId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!data) {
		throw error(404, 'Workspace not found');
	}
	if (data.owner_id !== userId) {
		throw error(403, 'Only the workspace owner can manage members');
	}
}

/**
 * GET /api/workspaces/[id]/members
 *
 * List members of a workspace (including the owner row implicitly via the
 * client by displaying it separately). Returns the explicit member rows from
 * workspace_members joined with auth.users for emails.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const workspaceId = params.id;

	// Read membership rows via the user's client so RLS confirms they can see
	// this workspace at all.
	const { data: rows, error: dbError } = await locals.supabase
		.from('workspace_members')
		.select('user_id, role, added_at')
		.eq('workspace_id', workspaceId);
	if (dbError) {
		throw error(500, dbError.message);
	}

	// Resolve user_id → email via admin (auth.users isn't directly readable).
	const admin = getSupabaseAdmin();
	const members = await Promise.all(
		(rows ?? []).map(async (m) => {
			const { data: u } = await admin.auth.admin.getUserById(m.user_id);
			return {
				userId: m.user_id,
				email: u.user?.email ?? '',
				role: assertRole(m.role),
				addedAt: m.added_at
			};
		})
	);

	return json({ members });
};

/**
 * POST /api/workspaces/[id]/members
 * body: { email: string, role: 'editor' | 'viewer' }
 *
 * Add a user to the workspace. Caller must be the owner. Email must belong to
 * an allowlisted user (app_members) who has signed in at least once (so the
 * auth.users row exists).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const workspaceId = params.id;
	await assertWorkspaceOwner(workspaceId, locals.user.id, locals.supabase);

	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const rawEmail = 'email' in body ? body.email : '';
	const email = String(rawEmail ?? '')
		.trim()
		.toLowerCase();
	const role = assertRole('role' in body ? body.role : null);

	if (!email || !email.includes('@')) {
		throw error(400, 'Valid email required');
	}
	if (email === (locals.user.email ?? '').toLowerCase()) {
		throw error(400, "You can't share a workspace with yourself");
	}

	const admin = getSupabaseAdmin();

	// Confirm the email is allowlisted on the platform.
	const { data: allow } = await admin
		.from('app_members')
		.select('email')
		.eq('email', email)
		.maybeSingle();
	if (!allow) {
		throw error(400, "That email isn't on the platform allowlist yet.");
	}

	// Look up the auth.users row by email. If they haven't signed in, no row.
	let targetUserId: string | null = null;
	let page = 1;
	const perPage = 200;
	while (page <= 5) {
		const { data, error: listErr } = await admin.auth.admin.listUsers({
			page,
			perPage
		});
		if (listErr) {
			throw error(500, listErr.message);
		}
		const found = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
		if (found) {
			targetUserId = found.id;
			break;
		}
		if (data.users.length < perPage) {
			break;
		}
		page++;
	}
	if (!targetUserId) {
		throw error(
			400,
			"That user is on the allowlist but hasn't signed in yet — ask them to log in once first."
		);
	}

	const { error: insErr } = await admin.from('workspace_members').upsert(
		{
			workspace_id: workspaceId,
			user_id: targetUserId,
			role,
			added_by: locals.user.id
		},
		{ onConflict: 'workspace_id,user_id' }
	);
	if (insErr) {
		throw error(500, insErr.message);
	}

	return json({ userId: targetUserId, email, role });
};
