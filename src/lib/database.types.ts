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
	DocumentRow,
	DocumentCommentRow,
	ApiTokenRow,
	Visibility,
	ProjectKind
} from './generated/types';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type {
	ProjectRow,
	WorkspaceRow,
	AppMemberRow,
	PasskeyRow,
	AppInviteRow,
	DocumentRow,
	DocumentCommentRow,
	ApiTokenRow,
	Visibility,
	ProjectKind
};

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
					kind?: ProjectKind;
					scene?: Json | null;
					visibility?: Visibility;
					position?: number | null;
				};
				Update: {
					name?: string;
					kind?: ProjectKind;
					scene?: Json | null;
					visibility?: Visibility;
					position?: number | null;
					workspace_id?: string;
				};
				Relationships: [];
			};
			documents: {
				Row: DocumentRow;
				Insert: {
					id?: string;
					project_id: string;
					name: string;
					content?: string;
					position?: number | null;
				};
				Update: {
					name?: string;
					content?: string;
					position?: number | null;
				};
				Relationships: [];
			};
			document_comments: {
				Row: DocumentCommentRow;
				Insert: {
					id?: string;
					document_id: string;
					parent_id?: string | null;
					body: string;
					anchor_quote?: string | null;
					anchor_prefix?: string;
					anchor_suffix?: string;
					anchor_start?: number | null;
					anchor_end?: number | null;
					created_by?: string | null;
					resolved_at?: string | null;
					resolved_by?: string | null;
				};
				Update: {
					body?: string;
					resolved_at?: string | null;
					resolved_by?: string | null;
					anchor_quote?: string | null;
					anchor_prefix?: string;
					anchor_suffix?: string;
					anchor_start?: number | null;
					anchor_end?: number | null;
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
			api_tokens: {
				Row: ApiTokenRow;
				Insert: {
					id?: string;
					user_id: string;
					name: string;
					token_hash: string;
					token_prefix: string;
					expires_at?: string | null;
				};
				Update: {
					name?: string;
					last_used_at?: string | null;
				};
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
};
