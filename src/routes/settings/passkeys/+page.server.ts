import { error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {throw error(401, 'Sign in first');}

	const { data, error: dbError } = await locals.supabase
		.from('passkeys')
		.select('credential_id, device_name, device_type, backed_up, created_at, last_used_at')
		.eq('user_id', locals.user.id)
		.order('created_at', { ascending: false });

	if (dbError) {throw error(500, dbError.message);}

	return {
		passkeys: data ?? [],
		forced: url.searchParams.get('force') === '1'
	};
};

export const actions: Actions = {
	remove: async ({ request, locals }) => {
		if (!locals.user) {return fail(401, { message: 'Sign in first' });}
		const form = await request.formData();
		const credentialId = String(form.get('credential_id') ?? '');
		if (!credentialId) {return fail(400, { message: 'Missing credential id' });}

		const { count } = await locals.supabase
			.from('passkeys')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', locals.user.id);
		if ((count ?? 0) <= 1) {
			return fail(400, {
				message:
					"Can't remove your last passkey. Register another one first, then remove this one."
			});
		}

		const { error: dbError } = await locals.supabase
			.from('passkeys')
			.delete()
			.eq('credential_id', credentialId)
			.eq('user_id', locals.user.id);
		if (dbError) {return fail(500, { message: dbError.message });}
		return { success: true };
	}
};
