import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { parseWorkspaceInviteNote } from '$lib/shared/workspace-invite-note';
import { findOrCreateUserByEmail, upsertWorkspaceMember } from '$lib/server/workspace-invites';

type Invite = {
	token: string;
	created_by: string | null;
	grant_admin: boolean;
	max_uses: number | null;
	use_count: number;
	expires_at: string | null;
	note: string | null;
};

type InviteResult = { ok: true; invite: Invite } | { ok: false; reason: string };

function validateInvite(invite: Invite | null): InviteResult {
	if (!invite) {
		return { ok: false, reason: 'This invite link is invalid.' };
	}
	if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
		return { ok: false, reason: 'This invite link has expired.' };
	}
	if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
		return { ok: false, reason: 'This invite link has been used up.' };
	}
	return { ok: true, invite };
}

export const load: PageServerLoad = async ({ params }) => {
	const admin = getSupabaseAdmin();
	const { data, error: dbError } = await admin
		.from('app_invites')
		.select('token, created_by, grant_admin, max_uses, use_count, expires_at, note')
		.eq('token', params.token)
		.maybeSingle();

	if (dbError) {
		throw error(500, dbError.message);
	}

	const result = validateInvite(data);
	const workspaceGrant = result.ok ? parseWorkspaceInviteNote(result.invite.note) : null;
	return {
		valid: result.ok,
		reason: result.ok ? null : result.reason,
		grantsAdmin: result.ok ? result.invite.grant_admin : false,
		// Workspace invites carry their grant in the note — don't show the raw
		// JSON; the page renders workspaceName instead.
		note: result.ok && !workspaceGrant ? result.invite.note : null,
		workspaceName: workspaceGrant?.workspaceName ?? null,
		workspaceRole: workspaceGrant?.role ?? null
	};
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		if (!email || !email.includes('@')) {
			return fail(400, { message: 'Enter a valid email address.' });
		}

		const admin = getSupabaseAdmin();

		const { data: inviteRow, error: inviteError } = await admin
			.from('app_invites')
			.select('token, created_by, grant_admin, max_uses, use_count, expires_at, note')
			.eq('token', params.token)
			.maybeSingle();
		if (inviteError) {
			return fail(500, { message: inviteError.message });
		}

		const result = validateInvite(inviteRow);
		if (!result.ok) {
			return fail(400, { message: result.reason });
		}

		// Add to allowlist (upsert: existing emails stay, role can be elevated).
		const { data: existing } = await admin
			.from('app_members')
			.select('email, is_admin')
			.eq('email', email)
			.maybeSingle();

		const willBeAdmin = (existing?.is_admin ?? false) || result.invite.grant_admin;

		const { error: upsertError } = await admin
			.from('app_members')
			.upsert({ email, is_admin: willBeAdmin }, { onConflict: 'email' });
		if (upsertError) {
			return fail(500, { message: upsertError.message });
		}

		// Workspace invites also join the workspace right now: the auth user is
		// created on the spot if this email has never signed in, so the
		// membership is already waiting when they first log in.
		const workspaceGrant = parseWorkspaceInviteNote(result.invite.note);
		if (workspaceGrant) {
			const who = await findOrCreateUserByEmail(admin, email);
			if ('error' in who) {
				return fail(500, { message: who.error });
			}
			const added = await upsertWorkspaceMember(admin, {
				workspaceId: workspaceGrant.workspaceId,
				userId: who.userId,
				role: workspaceGrant.role,
				addedBy: result.invite.created_by
			});
			if (added.error) {
				return fail(500, { message: added.error });
			}
		}

		// Increment use_count.
		const { error: updateError } = await admin
			.from('app_invites')
			.update({ use_count: result.invite.use_count + 1 })
			.eq('token', params.token);
		if (updateError) {
			return fail(500, { message: updateError.message });
		}

		throw redirect(303, `/auth/login?email=${encodeURIComponent(email)}`);
	}
};
