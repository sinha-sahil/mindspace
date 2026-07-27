import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Same-origin relative paths only — never an open redirect. */
function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
		return '/';
	}
	return raw;
}

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');
	const next = safeNext(url.searchParams.get('next'));

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			throw redirect(303, next);
		}
	}

	throw redirect(303, '/auth/login?error=invalid_code');
};
