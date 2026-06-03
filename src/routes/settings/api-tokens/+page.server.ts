import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/auth/login');
	}

	const { data } = await locals.supabase
		.from('api_tokens')
		.select('id, name, token_prefix, created_at, last_used_at, expires_at')
		.order('created_at', { ascending: false });

	return {
		tokens: data ?? [],
		userEmail: locals.user.email ?? ''
	};
};
