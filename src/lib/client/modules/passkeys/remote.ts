import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export function isSupported(): boolean {
	return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

export async function registerPasskey(deviceName: string | null = null): Promise<void> {
	const startRes = await fetch('/auth/passkey/register/start', {
		method: 'POST',
		credentials: 'same-origin'
	});
	if (!startRes.ok) {
		throw new Error(await startRes.text());
	}
	const opts = await startRes.json();

	const attResp = await startRegistration({ optionsJSON: opts });

	const finishRes = await fetch('/auth/passkey/register/finish', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ response: attResp, deviceName })
	});
	if (!finishRes.ok) {
		throw new Error(await finishRes.text());
	}
}

export async function loginWithPasskey(email: string | null = null): Promise<void> {
	const startRes = await fetch('/auth/passkey/login/start', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email })
	});
	if (!startRes.ok) {
		throw new Error(await startRes.text());
	}
	const opts = await startRes.json();

	const authResp = await startAuthentication({ optionsJSON: opts });

	const finishRes = await fetch('/auth/passkey/login/finish', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ response: authResp })
	});
	if (!finishRes.ok) {
		throw new Error(await finishRes.text());
	}
}
