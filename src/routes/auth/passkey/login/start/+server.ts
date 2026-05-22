import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateAuthenticationOptions, getRpId } from '$lib/server/passkey';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { decodePasskeyLoginBody } from '$lib/generated/types';

const CHALLENGE_COOKIE = 'mindspace_pk_auth_challenge';
const EMAIL_COOKIE = 'mindspace_pk_auth_email';

export const POST: RequestHandler = async ({ url, request, cookies }) => {
	const decoded = decodePasskeyLoginBody(await request.json().catch(() => ({})));
	const email: string = (decoded?.email ?? '').trim().toLowerCase();

	let allowCredentials: { id: string }[] = [];

	if (email) {
		const admin = getSupabaseAdmin();
		// Look up the user by email via admin API.
		const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
		const user = usersList.users.find((u) => u.email?.toLowerCase() === email);
		if (user) {
			const { data: passkeys } = await admin
				.from('passkeys')
				.select('credential_id')
				.eq('user_id', user.id);
			allowCredentials = (passkeys ?? []).map((p) => ({ id: p.credential_id }));
		}
	}

	const opts = await generateAuthenticationOptions({
		rpID: getRpId(url),
		allowCredentials,
		userVerification: 'preferred'
	});

	cookies.set(CHALLENGE_COOKIE, opts.challenge, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 5 * 60
	});
	if (email) {
		cookies.set(EMAIL_COOKIE, email, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 5 * 60
		});
	}

	return json(opts);
};
