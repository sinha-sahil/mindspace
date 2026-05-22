import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyAuthenticationResponse, getRpId, getOrigin } from '$lib/server/passkey';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { decodePasskeyLoginBody } from '$lib/generated/types';
import { isJSON, decodeString } from 'type-decoder';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

const CHALLENGE_COOKIE = 'mindspace_pk_auth_challenge';
const EMAIL_COOKIE = 'mindspace_pk_auth_email';

export const POST: RequestHandler = async ({ url, locals, cookies, request }) => {
	const expectedChallenge = cookies.get(CHALLENGE_COOKIE);
	if (!expectedChallenge) {
		throw error(400, 'Authentication challenge missing or expired');
	}

	const rawBody = await request.json();
	const decoded = decodePasskeyLoginBody(rawBody);
	if (!decoded || !decoded.response) {
		throw error(400, 'Invalid request body');
	}

	// decoded.response is `unknown` — pull out the credential id via the runtime decoder.
	const credentialId = isJSON(decoded.response) ? decodeString(decoded.response['id']) : null;
	if (!credentialId) {
		throw error(400, 'Missing credential id');
	}

	// rawBody.response is typed `any` from request.json(); simplewebauthn validates the shape.
	const response: AuthenticationResponseJSON = rawBody.response;

	const admin = getSupabaseAdmin();

	const { data: passkey, error: lookupError } = await admin
		.from('passkeys')
		.select('credential_id, user_id, public_key, counter')
		.eq('credential_id', credentialId)
		.single();

	if (lookupError || !passkey) {
		throw error(404, 'Unknown passkey');
	}

	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge,
		expectedOrigin: getOrigin(url),
		expectedRPID: getRpId(url),
		credential: {
			id: passkey.credential_id,
			publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64')),
			counter: Number(passkey.counter)
		},
		requireUserVerification: false
	});

	if (!verification.verified || !verification.authenticationInfo) {
		throw error(401, 'Passkey did not verify');
	}

	// Update counter + last_used_at.
	await admin
		.from('passkeys')
		.update({
			counter: verification.authenticationInfo.newCounter,
			last_used_at: new Date().toISOString()
		})
		.eq('credential_id', credentialId);

	// Look up the user's email so we can mint a session.
	const { data: userResp, error: userError } = await admin.auth.admin.getUserById(passkey.user_id);
	if (userError || !userResp?.user?.email) {
		throw error(500, 'User lookup failed');
	}
	const email = userResp.user.email;

	// Allowlist check before issuing a session.
	const { data: member } = await admin
		.from('app_members')
		.select('email')
		.eq('email', email.toLowerCase())
		.maybeSingle();
	if (!member) {
		throw error(403, 'Email is not on the allowlist');
	}

	// Generate a magic-link OTP and immediately verify it server-side. This sets
	// the session cookies on the response via the SSR Supabase client.
	const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
		type: 'magiclink',
		email
	});
	if (linkError || !linkData?.properties?.email_otp) {
		throw error(500, linkError?.message ?? 'Failed to mint session token');
	}

	const { error: verifyError } = await locals.supabase.auth.verifyOtp({
		email,
		token: linkData.properties.email_otp,
		type: 'magiclink'
	});
	if (verifyError) {
		throw error(500, verifyError.message);
	}

	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	cookies.delete(EMAIL_COOKIE, { path: '/' });

	return json({ ok: true });
};
