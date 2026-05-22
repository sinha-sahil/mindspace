import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Database } from '$lib/database.types';

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {return { session: null, user: null };}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) {return { session: null, user: null };}

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

const authGuard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;
	event.locals.isMember = false;
	event.locals.isAdmin = false;

	const path = event.url.pathname;
	const isAuthRoute = path.startsWith('/auth');
	const isPublicRoute =
		path.startsWith('/p/') || path.startsWith('/invite/');

	if (!session) {
		if (!isAuthRoute && !isPublicRoute) {throw redirect(303, '/auth/login');}
		return resolve(event);
	}

	// Allowlist check.
	const { data: membership } = await event.locals.supabase
		.from('app_members')
		.select('email, is_admin')
		.eq('email', user!.email!.toLowerCase())
		.maybeSingle();

	if (!membership) {
		// Public routes are fine without allowlist (e.g. shared link viewer).
		if (isPublicRoute) {return resolve(event);}
		// Otherwise sign out and bounce to login.
		await event.locals.supabase.auth.signOut();
		throw redirect(303, '/auth/login?error=not_authorized');
	}

	event.locals.isMember = true;
	event.locals.isAdmin = !!membership.is_admin;

	if (path === '/auth/login') {throw redirect(303, '/');}

	if (path.startsWith('/admin') && !event.locals.isAdmin) {
		throw redirect(303, '/');
	}

	// Mandatory passkey enrollment.
	// Anyone signed in without a passkey is force-routed to /settings/passkeys
	// until they register one. /auth/* and the settings page itself are exempt
	// so the bootstrap (magic-link sign-in → register passkey) loop completes.
	const isEnrollExempt =
		isAuthRoute || isPublicRoute || path === '/settings/passkeys';
	if (!isEnrollExempt) {
		const { count } = await event.locals.supabase
			.from('passkeys')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', user!.id);
		if (!count || count === 0) {
			throw redirect(303, '/settings/passkeys?force=1');
		}
	}

	return resolve(event);
};

export const handle = sequence(supabase, authGuard);
