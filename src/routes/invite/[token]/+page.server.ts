import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

type Invite = {
	token: string;
	grant_admin: boolean;
	max_uses: number | null;
	use_count: number;
	expires_at: string | null;
	note: string | null;
};

type InviteResult =
	| { ok: true; invite: Invite }
	| { ok: false; reason: string };

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
		.select('token, grant_admin, max_uses, use_count, expires_at, note')
		.eq('token', params.token)
		.maybeSingle();

	if (dbError) {throw error(500, dbError.message);}

	const result = validateInvite(data);
	return {
		valid: result.ok,
		reason: result.ok ? null : result.reason,
		grantsAdmin: result.ok ? result.invite.grant_admin : false,
		note: result.ok ? result.invite.note : null
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
			.select('token, grant_admin, max_uses, use_count, expires_at, note')
			.eq('token', params.token)
			.maybeSingle();
		if (inviteError) {return fail(500, { message: inviteError.message });}

		const result = validateInvite(inviteRow);
		if (!result.ok) {return fail(400, { message: result.reason });}

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
		if (upsertError) {return fail(500, { message: upsertError.message });}

		// Increment use_count.
		const { error: updateError } = await admin
			.from('app_invites')
			.update({ use_count: result.invite.use_count + 1 })
			.eq('token', params.token);
		if (updateError) {return fail(500, { message: updateError.message });}

		throw redirect(303, `/auth/login?email=${encodeURIComponent(email)}`);
	}
};
