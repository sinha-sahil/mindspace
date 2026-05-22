import {
	generateRegistrationOptions,
	generateAuthenticationOptions,
	verifyRegistrationResponse,
	verifyAuthenticationResponse,
	type GenerateRegistrationOptionsOpts,
	type GenerateAuthenticationOptionsOpts,
	type VerifyRegistrationResponseOpts,
	type VerifyAuthenticationResponseOpts
} from '@simplewebauthn/server';

const RP_NAME = 'mindspace';

/**
 * Derive the WebAuthn Relying Party id (RP ID) from the request URL.
 *  - localhost ⇒ "localhost"
 *  - production ⇒ the bare hostname, e.g. "mindspace-lilac.vercel.app"
 *
 * RP ID must match the host the user is browsing to or be a registrable suffix.
 */
export function getRpId(url: URL): string {
	return url.hostname;
}

export function getRpName(): string {
	return RP_NAME;
}

export function getOrigin(url: URL): string {
	return url.origin;
}

/**
 * Encode a string-coerced challenge to be stored in a cookie.
 */
export type RegisterOptions = Awaited<ReturnType<typeof generateRegistrationOptions>>;
export type AuthOptions = Awaited<ReturnType<typeof generateAuthenticationOptions>>;

export {
	generateRegistrationOptions,
	generateAuthenticationOptions,
	verifyRegistrationResponse,
	verifyAuthenticationResponse,
	type GenerateRegistrationOptionsOpts,
	type GenerateAuthenticationOptionsOpts,
	type VerifyRegistrationResponseOpts,
	type VerifyAuthenticationResponseOpts
};
