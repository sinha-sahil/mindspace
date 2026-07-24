import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { makeWorkspaceInviteNote } from '$lib/shared/workspace-invite-note';

const INVITE_MAX_USES = 25;
const INVITE_TTL_DAYS = 30;

/**
 * POST /api/workspaces/[id]/invites
 * body: { role?: 'editor' | 'viewer' }
 *
 * Mint a shareable invite link for THIS workspace. Owner-only. The link is a
 * regular app invite (allowlists the email on accept) whose note carries the
 * workspace grant — accepting it adds the person to the workspace with the
 * chosen role, whether or not they have ever signed in.
 */
export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const workspaceId = params.id;

	// Owner check through the caller's own client so RLS vouches for access.
	const { data: ws, error: wsErr } = await locals.supabase
		.from('workspaces')
		.select('id, name, owner_id')
		.eq('id', workspaceId)
		.maybeSingle();
	if (wsErr) {
		throw error(500, wsErr.message);
	}
	if (!ws) {
		throw error(404, 'Workspace not found');
	}
	if (ws.owner_id !== locals.user.id) {
		throw error(403, 'Only the workspace owner can create invite links');
	}

	const body: unknown = await request.json().catch(() => null);
	const rawRole = body && typeof body === 'object' && 'role' in body ? body.role : null;
	const role = rawRole === 'viewer' ? 'viewer' : 'editor';

	const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const admin = getSupabaseAdmin();
	const { data: invite, error: insErr } = await admin
		.from('app_invites')
		.insert({
			created_by: locals.user.id,
			grant_admin: false,
			max_uses: INVITE_MAX_USES,
			expires_at: expiresAt,
			note: makeWorkspaceInviteNote({ workspaceId: ws.id, role, workspaceName: ws.name })
		})
		.select('token')
		.single();
	if (insErr || !invite) {
		throw error(500, insErr?.message ?? 'Could not create the invite');
	}

	return json({
		url: `${url.origin}/invite/${invite.token}`,
		token: invite.token,
		role,
		expiresAt,
		maxUses: INVITE_MAX_USES
	});
};
