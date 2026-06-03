import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.isAdmin) {
		throw error(403, 'Forbidden');
	}

	const [members, invites] = await Promise.all([
		locals.supabase
			.from('app_members')
			.select('email, is_admin, created_at')
			.order('created_at', { ascending: true }),
		locals.supabase
			.from('app_invites')
			.select('token, grant_admin, max_uses, use_count, expires_at, note, created_at')
			.order('created_at', { ascending: false })
	]);

	if (members.error) {
		throw error(500, members.error.message);
	}
	if (invites.error) {
		throw error(500, invites.error.message);
	}

	return {
		members: members.data ?? [],
		invites: invites.data ?? []
	};
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { message: 'Forbidden' });
		}
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const isAdmin = form.get('is_admin') === 'on';
		if (!email || !email.includes('@')) {
			return fail(400, { message: 'Invalid email' });
		}

		const { error: dbError } = await locals.supabase
			.from('app_members')
			.upsert({ email, is_admin: isAdmin, added_by: locals.user!.id }, { onConflict: 'email' });
		if (dbError) {
			return fail(500, { message: dbError.message });
		}
		return { success: true };
	},

	toggleAdmin: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { message: 'Forbidden' });
		}
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const isAdmin = form.get('is_admin') === 'true';
		if (!email) {
			return fail(400, { message: 'Missing email' });
		}

		if (email === locals.user!.email!.toLowerCase() && !isAdmin) {
			return fail(400, { message: "You can't remove your own admin role." });
		}

		const { error: dbError } = await locals.supabase
			.from('app_members')
			.update({ is_admin: isAdmin })
			.eq('email', email);
		if (dbError) {
			return fail(500, { message: dbError.message });
		}
		return { success: true };
	},

	remove: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { message: 'Forbidden' });
		}
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		if (!email) {
			return fail(400, { message: 'Missing email' });
		}
		if (email === locals.user!.email!.toLowerCase()) {
			return fail(400, { message: "You can't remove yourself." });
		}

		const { error: dbError } = await locals.supabase
			.from('app_members')
			.delete()
			.eq('email', email);
		if (dbError) {
			return fail(500, { message: dbError.message });
		}
		return { success: true };
	},

	createInvite: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { message: 'Forbidden' });
		}
		const form = await request.formData();
		const grantAdmin = form.get('grant_admin') === 'on';
		const note =
			String(form.get('note') ?? '')
				.trim()
				.slice(0, 80) || null;

		const maxUsesRaw = String(form.get('max_uses') ?? '').trim();
		const maxUses = maxUsesRaw ? Math.max(1, parseInt(maxUsesRaw, 10) || 0) : null;

		const expiresInDaysRaw = String(form.get('expires_in_days') ?? '').trim();
		const expiresIn = expiresInDaysRaw ? Math.max(1, parseInt(expiresInDaysRaw, 10) || 0) : null;
		const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 86400_000).toISOString() : null;

		const { error: dbError } = await locals.supabase.from('app_invites').insert({
			created_by: locals.user!.id,
			grant_admin: grantAdmin,
			max_uses: maxUses,
			expires_at: expiresAt,
			note
		});
		if (dbError) {
			return fail(500, { message: dbError.message });
		}
		return { success: true };
	},

	revokeInvite: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { message: 'Forbidden' });
		}
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();
		if (!token) {
			return fail(400, { message: 'Missing token' });
		}
		const { error: dbError } = await locals.supabase
			.from('app_invites')
			.delete()
			.eq('token', token);
		if (dbError) {
			return fail(500, { message: dbError.message });
		}
		return { success: true };
	}
};
