import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateApiToken } from '$lib/server/api-tokens';

/**
 * GET /api/api-tokens — list the caller's tokens (no raw values).
 * Cookie-auth only: a token can't list its own existence.
 */
export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	// Block API-token callers — token management is a UI flow.
	if (request.headers.get('authorization')?.startsWith('Bearer ')) {
		throw error(403, 'API tokens cannot manage other tokens — use a browser session');
	}

	const { data, error: dbError } = await locals.supabase
		.from('api_tokens')
		.select('id, name, token_prefix, created_at, last_used_at, expires_at')
		.order('created_at', { ascending: false });

	if (dbError) {
		throw error(500, dbError.message);
	}
	return json({ tokens: data ?? [] });
};

/**
 * POST /api/api-tokens — create a token. Returns the RAW value ONCE.
 * body: { name: string, expires_at?: ISO string | null }
 *
 * The DB only stores sha256(raw); the raw value can never be retrieved
 * again, so the client must capture it from this response.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	if (request.headers.get('authorization')?.startsWith('Bearer ')) {
		throw error(403, 'API tokens cannot create other tokens — use a browser session');
	}

	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const rawName = 'name' in body && typeof body.name === 'string' ? body.name.trim() : '';
	if (!rawName) {
		throw error(400, 'name is required');
	}
	if (rawName.length > 80) {
		throw error(400, 'name must be 80 characters or fewer');
	}

	let expiresAt: string | null = null;
	if ('expires_at' in body && typeof body.expires_at === 'string' && body.expires_at) {
		const ts = Date.parse(body.expires_at);
		if (!Number.isFinite(ts)) {
			throw error(400, 'expires_at must be a valid ISO date');
		}
		if (ts <= Date.now()) {
			throw error(400, 'expires_at must be in the future');
		}
		expiresAt = new Date(ts).toISOString();
	}

	const token = await generateApiToken();

	const { data, error: dbError } = await locals.supabase
		.from('api_tokens')
		.insert({
			user_id: locals.user.id,
			name: rawName,
			token_hash: token.hash,
			token_prefix: token.prefix,
			expires_at: expiresAt
		})
		.select('id, name, token_prefix, created_at, expires_at')
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not create token');
	}

	// The raw token is returned ONCE here. After this response there is no
	// way to retrieve it again — only the prefix + hash remain in the DB.
	return json(
		{
			id: data.id,
			name: data.name,
			token_prefix: data.token_prefix,
			created_at: data.created_at,
			expires_at: data.expires_at,
			raw: token.raw
		},
		{ status: 201 }
	);
};
