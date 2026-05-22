import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/database.types';

export type AppSupabaseClient = SupabaseClient<Database>;

declare global {
	namespace App {
		interface Locals {
			supabase: AppSupabaseClient;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			session: Session | null;
			user: User | null;
			isMember: boolean;
			isAdmin: boolean;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
			isAdmin: boolean;
		}
	}
}

export {};
