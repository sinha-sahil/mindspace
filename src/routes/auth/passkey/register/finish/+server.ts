import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyRegistrationResponse, getRpId, getOrigin } from '$lib/server/passkey';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { decodePasskeyRegisterFinishBody } from '$lib/generated/types';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

const CHALLENGE_COOKIE = 'mindspace_pk_reg_challenge';

export const POST: RequestHandler = async ({ url, locals, cookies, request }) => {
	if (!locals.user) {
		throw error(401, 'Sign in first');
	}

	const expectedChallenge = cookies.get(CHALLENGE_COOKIE);
	if (!expectedChallenge) {
		throw error(400, 'Registration challenge missing or expired');
	}

	const rawBody = await request.json();
	const decoded = decodePasskeyRegisterFinishBody(rawBody);
	if (!decoded) {
		throw error(400, 'Invalid request body');
	}
	// rawBody.response is `any` from request.json(); simplewebauthn validates
	// the shape for us — we only need the decoder for the envelope.
	const response: RegistrationResponseJSON = rawBody.response;
	const deviceName: string = (decoded.deviceName ?? '').slice(0, 60);

	const verification = await verifyRegistrationResponse({
		response,
		expectedChallenge,
		expectedOrigin: getOrigin(url),
		expectedRPID: getRpId(url),
		requireUserVerification: false
	});

	if (!verification.verified || !verification.registrationInfo) {
		throw error(400, 'Passkey registration failed verification');
	}

	const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

	const publicKeyB64 = Buffer.from(credential.publicKey).toString('base64');

	const transports: string[] = response.response.transports ?? [];

	const admin = getSupabaseAdmin();
	const { error: dbError } = await admin.from('passkeys').insert({
		credential_id: credential.id,
		user_id: locals.user.id,
		public_key: publicKeyB64,
		counter: credential.counter ?? 0,
		transports,
		device_type: credentialDeviceType ?? null,
		backed_up: credentialBackedUp ?? false,
		device_name: deviceName.length > 0 ? deviceName : null
	});

	cookies.delete(CHALLENGE_COOKIE, { path: '/' });

	if (dbError) {
		throw error(500, dbError.message);
	}

	return json({ ok: true });
};
