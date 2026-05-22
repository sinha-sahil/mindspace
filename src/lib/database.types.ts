/**
 * Database type for the Supabase client generic.
 *
 * Row shapes come from `$lib/generated/types` (generated via type-crafter
 * from `types/schema.yaml`). Insert/Update shapes are hand-written here
 * because they're write-side only and don't need runtime decoders.
 */
import type {
	ProjectRow,
	WorkspaceRow,
	AppMemberRow,
	PasskeyRow,
	AppInviteRow,
	Visibility
} from './generated/types';

export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json }
	| Json[];

export type { ProjectRow, WorkspaceRow, AppMemberRow, PasskeyRow, AppInviteRow, Visibility };

export type Database = {
	public: {
		Tables: {
			app_members: {
				Row: AppMemberRow;
				Insert: {
					email: string;
					is_admin?: boolean;
					added_by?: string | null;
				};
				Update: {
					is_admin?: boolean;
				};
				Relationships: [];
			};
			workspaces: {
				Row: WorkspaceRow;
				Insert: {
					id?: string;
					name: string;
					owner_id: string;
				};
				Update: {
					name?: string;
				};
				Relationships: [];
			};
			workspace_members: {
				Row: {
					workspace_id: string;
					user_id: string;
					role: 'editor' | 'viewer';
					added_by: string | null;
					added_at: string;
				};
				Insert: {
					workspace_id: string;
					user_id: string;
					role: 'editor' | 'viewer';
					added_by?: string | null;
				};
				Update: {
					role?: 'editor' | 'viewer';
				};
				Relationships: [];
			};
			projects: {
				Row: ProjectRow;
				Insert: {
					id?: string;
					workspace_id: string;
					name: string;
					scene?: Json | null;
					visibility?: Visibility;
					position?: number | null;
				};
				Update: {
					name?: string;
					scene?: Json | null;
					visibility?: Visibility;
					position?: number | null;
					workspace_id?: string;
				};
				Relationships: [];
			};
			passkeys: {
				Row: PasskeyRow;
				Insert: {
					credential_id: string;
					user_id: string;
					public_key: string;
					counter: number;
					transports?: string[];
					device_type?: string | null;
					backed_up?: boolean;
					device_name?: string | null;
				};
				Update: {
					counter?: number;
					last_used_at?: string | null;
					device_name?: string | null;
				};
				Relationships: [];
			};
			app_invites: {
				Row: AppInviteRow;
				Insert: {
					token?: string;
					created_by?: string | null;
					grant_admin?: boolean;
					max_uses?: number | null;
					use_count?: number;
					expires_at?: string | null;
					note?: string | null;
				};
				Update: {
					use_count?: number;
				};
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}
