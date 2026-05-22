import type { LayoutServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';

/**
 * Make sure every authenticated app-member has at least one workspace they
 * can access — owned by them or shared with them — before the client loads.
 *
 * Done server-side with the admin client so the very first workspace for a
 * brand-new user can never be blocked by client-side RLS edge cases (which
 * has historically broken for newly invited users).
 */
async function ensurePersonalWorkspace(
	supabase: App.Locals['supabase'],
	userId: string
): Promise<void> {
	// Cheap, indexed lookup: any workspace owned by us, OR any workspace
	// where we're a member. If either returns a row we're done.
	const [owned, membered] = await Promise.all([
		supabase.from('workspaces').select('id').eq('owner_id', userId).limit(1),
		supabase
			.from('workspace_members')
			.select('workspace_id')
			.eq('user_id', userId)
			.limit(1)
	]);

	if ((owned.data && owned.data.length > 0) || (membered.data && membered.data.length > 0)) {
		return;
	}

	// Use the service-role client so the first workspace creation cannot
	// fail on RLS. Subsequent workspaces go through the normal user-scoped
	// insert (which only requires owner_id = auth.uid()).
	const admin = getSupabaseAdmin();
	await admin.from('workspaces').insert({ name: 'Personal', owner_id: userId });
}

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	if (locals.user && locals.isMember) {
		try {
			await ensurePersonalWorkspace(locals.supabase, locals.user.id);
		} catch (err) {
			// Don't block the page load — surface in logs and let the
			// client's existing empty-state handle the (rare) failure.
			console.error('[layout] ensurePersonalWorkspace failed:', err);
		}
	}

	return {
		session: locals.session,
		user: locals.user,
		isAdmin: locals.isAdmin,
		cookies: cookies.getAll()
	};
};
