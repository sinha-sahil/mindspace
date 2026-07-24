/**
 * Workspace invites ride on the existing `app_invites` table — the grant is
 * encoded in its free-text `note` column as JSON, so no schema change is
 * needed. These helpers are the single source of truth for that encoding and
 * are import-safe on both server and client (pure functions, no secrets).
 */

export type WorkspaceInviteNote = {
	workspaceId: string;
	role: 'editor' | 'viewer';
	workspaceName: string;
};

const KIND = 'workspace-invite';

export function makeWorkspaceInviteNote(invite: WorkspaceInviteNote): string {
	return JSON.stringify({
		kind: KIND,
		ws: invite.workspaceId,
		role: invite.role,
		name: invite.workspaceName
	});
}

export function parseWorkspaceInviteNote(note: string | null): WorkspaceInviteNote | null {
	if (!note || !note.startsWith('{')) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(note);
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}
		const kind = 'kind' in parsed ? parsed.kind : null;
		const ws = 'ws' in parsed ? parsed.ws : null;
		const name = 'name' in parsed ? parsed.name : null;
		const rawRole = 'role' in parsed ? parsed.role : null;
		if (kind !== KIND || typeof ws !== 'string' || typeof name !== 'string') {
			return null;
		}
		const role = rawRole === 'viewer' ? 'viewer' : 'editor';
		return { workspaceId: ws, role, workspaceName: name };
	} catch {
		return null;
	}
}
