import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { Database } from '$lib/database.types';

type AdminClient = SupabaseClient<Database>;

let _admin: AdminClient | null = null;

/**
 * Server-only Supabase client with the service-role key. Bypasses RLS.
 * Use sparingly: only for operations that genuinely require elevated access
 * (passkey credential storage, session minting from non-magic-link flows, etc.)
 */
export function getSupabaseAdmin(): AdminClient {
	if (_admin) {
		return _admin;
	}
	const url = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const serviceKey = privateEnv.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !serviceKey) {
		throw new Error(
			'Supabase admin client not configured: PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.'
		);
	}
	_admin = createClient<Database>(url, serviceKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	return _admin;
}
