import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Database } from '$lib/database.types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { sha256Hex } from '$lib/server/api-tokens';

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
		if (!session) {
			return { session: null, user: null };
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) {
			return { session: null, user: null };
		}

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

/**
 * If the request carries `Authorization: Bearer <token>`, resolve it to a
 * user via the admin client, populate `locals.user` / `isMember` / `isAdmin`,
 * and short-circuit the rest of authGuard (no redirects, no passkey check —
 * token requests are programmatic API calls). Returns null if no token or
 * the token is invalid (caller decides what to do).
 *
 * The lookup uses sha256(raw) so only hashes are ever compared against the
 * DB column. Valid tokens get their `last_used_at` bumped fire-and-forget.
 */
async function resolveBearerToken(
	event: Parameters<Handle>[0]['event']
): Promise<{ ok: true } | { ok: false; status: number; message: string } | null> {
	const auth = event.request.headers.get('authorization');
	if (!auth || !auth.startsWith('Bearer ')) {
		return null;
	}
	const raw = auth.slice(7).trim();
	if (!raw) {
		return null;
	}

	const hash = await sha256Hex(raw);
	const admin = getSupabaseAdmin();

	const { data: tokenRow } = await admin
		.from('api_tokens')
		.select('id, user_id, expires_at')
		.eq('token_hash', hash)
		.maybeSingle();

	if (!tokenRow) {
		return { ok: false, status: 401, message: 'Invalid API token' };
	}
	if (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date()) {
		return { ok: false, status: 401, message: 'API token has expired' };
	}

	const { data: userResult } = await admin.auth.admin.getUserById(tokenRow.user_id);
	const u = userResult.user;
	if (!u || !u.email) {
		return { ok: false, status: 401, message: 'Token user no longer exists' };
	}

	const { data: membership } = await admin
		.from('app_members')
		.select('email, is_admin')
		.eq('email', u.email.toLowerCase())
		.maybeSingle();

	if (!membership) {
		return { ok: false, status: 403, message: 'Token user is not on the allowlist' };
	}

	event.locals.user = u;
	event.locals.session = null;
	event.locals.isMember = true;
	event.locals.isAdmin = !!membership.is_admin;

	// Fire-and-forget: bump last_used_at. Don't await — keeps the request hot path fast.
	admin
		.from('api_tokens')
		.update({ last_used_at: new Date().toISOString() })
		.eq('id', tokenRow.id)
		.then(
			() => {},
			() => {}
		);

	return { ok: true };
}

const authGuard: Handle = async ({ event, resolve }) => {
	event.locals.session = null;
	event.locals.user = null;
	event.locals.isMember = false;
	event.locals.isAdmin = false;

	// Try API-token auth first. If a Bearer header is present, the request
	// is programmatic — fully handled by this branch (no UI redirects, no
	// passkey enrollment gate). Restricted to /api/* paths because UI routes
	// rely on a real Supabase session cookie for their data loaders.
	const tokenResult = await resolveBearerToken(event);
	if (tokenResult) {
		if (!tokenResult.ok) {
			return new Response(tokenResult.message, { status: tokenResult.status });
		}
		// Token-auth is allowed on /api/* (REST endpoints) and /mcp (the
		// MCP JSON-RPC endpoint that LLM clients hit). UI routes are not.
		const isApiPath = event.url.pathname.startsWith('/api/') || event.url.pathname === '/mcp';
		if (!isApiPath) {
			return new Response('API tokens are only valid on API paths', { status: 403 });
		}
		return resolve(event);
	}

	// Cookie-based session auth (the browser path).
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	const path = event.url.pathname;
	const isAuthRoute = path.startsWith('/auth');
	// `/dev/*` harness pages exist only under `vite dev` (the pages themselves
	// also self-guard) — exempt them like public routes so component iteration
	// doesn't require a session.
	const isPublicRoute =
		path.startsWith('/p/') || path.startsWith('/invite/') || (dev && path.startsWith('/dev/'));
	// API-shaped paths must never redirect to /auth/login — a 303 to HTML is
	// useless to a JSON-RPC or fetch client. Return a clean 401 instead.
	const isApiShaped = path.startsWith('/api/') || path === '/mcp';

	if (!session) {
		if (isApiShaped) {
			return new Response('Authentication required', { status: 401 });
		}
		if (!isAuthRoute && !isPublicRoute) {
			throw redirect(303, '/auth/login');
		}
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
		if (isPublicRoute) {
			return resolve(event);
		}
		// Otherwise sign out and bounce to login.
		await event.locals.supabase.auth.signOut();
		throw redirect(303, '/auth/login?error=not_authorized');
	}

	event.locals.isMember = true;
	event.locals.isAdmin = !!membership.is_admin;

	if (path === '/auth/login') {
		throw redirect(303, '/');
	}

	if (path.startsWith('/admin') && !event.locals.isAdmin) {
		throw redirect(303, '/');
	}

	// Mandatory passkey enrollment.
	// Anyone signed in without a passkey is force-routed to /settings/passkeys
	// until they register one. /auth/* and the settings page itself are exempt
	// so the bootstrap (magic-link sign-in → register passkey) loop completes.
	const isEnrollExempt = isAuthRoute || isPublicRoute || path === '/settings/passkeys';
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
