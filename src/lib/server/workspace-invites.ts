import type { getSupabaseAdmin } from '$lib/server/supabase-admin';

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/**
 * Resolve an email to an auth user id, creating the user when they have
 * never signed in. Created users are email-confirmed shells — their first
 * magic-link / passkey sign-in works exactly as if they had self-registered.
 * This is what lets an invite (or an owner's "Add by email") take effect
 * immediately instead of dead-ending on "ask them to log in once first".
 */
export async function findOrCreateUserByEmail(
	admin: AdminClient,
	email: string
): Promise<{ userId: string; created: boolean } | { error: string }> {
	let page = 1;
	const perPage = 200;
	while (page <= 10) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
		if (error) {
			return { error: error.message };
		}
		const found = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
		if (found) {
			return { userId: found.id, created: false };
		}
		if (data.users.length < perPage) {
			break;
		}
		page++;
	}

	const { data: created, error: createErr } = await admin.auth.admin.createUser({
		email,
		email_confirm: true
	});
	if (createErr || !created.user) {
		return { error: createErr?.message ?? 'Could not create the user' };
	}
	return { userId: created.user.id, created: true };
}

/** Upsert a workspace membership (idempotent on workspace+user). */
export async function upsertWorkspaceMember(
	admin: AdminClient,
	args: { workspaceId: string; userId: string; role: 'editor' | 'viewer'; addedBy: string | null }
): Promise<{ error: string } | { error?: never }> {
	const { error } = await admin.from('workspace_members').upsert(
		{
			workspace_id: args.workspaceId,
			user_id: args.userId,
			role: args.role,
			added_by: args.addedBy
		},
		{ onConflict: 'workspace_id,user_id' }
	);
	if (error) {
		return { error: error.message };
	}
	return {};
}
