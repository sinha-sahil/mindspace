import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateRegistrationOptions, getRpId, getRpName } from '$lib/server/passkey';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

const CHALLENGE_COOKIE = 'mindspace_pk_reg_challenge';

export const POST: RequestHandler = async ({ url, locals, cookies }) => {
	if (!locals.user) {
		throw error(401, 'Sign in first');
	}

	const admin = getSupabaseAdmin();
	const { data: existing } = await admin
		.from('passkeys')
		.select('credential_id')
		.eq('user_id', locals.user.id);

	const opts = await generateRegistrationOptions({
		rpName: getRpName(),
		rpID: getRpId(url),
		userID: new TextEncoder().encode(locals.user.id),
		userName: locals.user.email ?? locals.user.id,
		userDisplayName: locals.user.email ?? locals.user.id,
		attestationType: 'none',
		excludeCredentials: (existing ?? []).map((p) => ({ id: p.credential_id })),
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred'
		}
	});

	cookies.set(CHALLENGE_COOKIE, opts.challenge, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 5 * 60
	});

	return json(opts);
};
