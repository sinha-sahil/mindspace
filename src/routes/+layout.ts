import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import type { Database } from '$lib/database.types';
import type { LayoutLoad } from './$types';

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
				global: { fetch }
			})
		: createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
				global: { fetch },
				cookies: {
					getAll: () => data.cookies
				}
			});

	const {
		data: { session }
	} = await supabase.auth.getSession();

	const {
		data: { user }
	} = await supabase.auth.getUser();

	return { session, supabase, user, isAdmin: data.isAdmin };
};
