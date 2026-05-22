import { browser } from '$app/environment';
import type { AppSupabaseClient } from '../../../../app';
import { analytics } from '../analytics';

export type Workspace = {
	id: string;
	name: string;
	ownerId: string;
	createdAt: number;
}

type WorkspaceRow = {
	id: string;
	name: string;
	owner_id: string;
	created_at: string;
}

type StoreState = {
	items: Workspace[];
	activeId: string | null;
	loading: boolean;
	error: string | null;
}

const ACTIVE_KEY_PREFIX = 'mindspace::active-workspace::';

function rowToWorkspace(row: WorkspaceRow): Workspace {
	return {
		id: row.id,
		name: row.name,
		ownerId: row.owner_id,
		createdAt: new Date(row.created_at).getTime()
	};
}

function createStore() {
	const state: StoreState = $state({
		items: [],
		activeId: null,
		loading: true,
		error: null
	});

	let client: AppSupabaseClient | null = null;
	let currentUserId: string | null = null;
	let activeChangeListener:
		| ((supabase: AppSupabaseClient, workspaceId: string) => void)
		| null = null;

	function fireActiveChange() {
		if (!activeChangeListener || !client || !state.activeId) {
			return;
		}
		activeChangeListener(client, state.activeId);
	}

	async function init(supabase: AppSupabaseClient, userId: string) {
		if (client === supabase && currentUserId === userId) {
			return;
		}
		client = supabase;
		currentUserId = userId;

		state.loading = true;
		state.error = null;

		const { data, error } = await supabase
			.from('workspaces')
			.select('id, name, owner_id, created_at')
			.order('created_at', { ascending: true });

		if (error) {
			state.error = error.message;
			state.loading = false;
			return;
		}

		const items = (data ?? []).map(rowToWorkspace);
		// First-workspace bootstrap is handled server-side in
		// src/routes/+layout.server.ts via the admin client, so the client
		// just lists what exists.

		state.items = items;

		if (browser) {
			const stored = localStorage.getItem(ACTIVE_KEY_PREFIX + userId);
			state.activeId =
				stored && items.some((w) => w.id === stored)
					? stored
					: (items[0]?.id ?? null);
		} else {
			state.activeId = items[0]?.id ?? null;
		}

		state.loading = false;
		fireActiveChange();
	}

	function persistActiveId() {
		if (!browser || !currentUserId) {
			return;
		}
		if (state.activeId) {
			localStorage.setItem(ACTIVE_KEY_PREFIX + currentUserId, state.activeId);
		}
	}

	function select(id: string) {
		if (state.items.some((w) => w.id === id)) {
			state.activeId = id;
			persistActiveId();
			fireActiveChange();
			analytics.track('workspace_switched', { workspace_id: id });
		}
	}

	async function add(name: string): Promise<Workspace | null> {
		const trimmed = name.trim();
		if (!trimmed) {
			return null;
		}

		// Create through the server endpoint, which uses the admin client and
		// trusts the authenticated session for owner_id. Avoids any client RLS
		// failure modes during the user-initiated workspace-creation flow.
		let ws: Workspace;
		try {
			const res = await fetch('/api/workspaces', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: trimmed })
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			const row = (await res.json()) as WorkspaceRow;
			ws = rowToWorkspace(row);
		} catch (e) {
			state.error = e instanceof Error ? e.message : 'Failed to create workspace';
			return null;
		}

		state.items = [...state.items, ws];
		state.activeId = ws.id;
		persistActiveId();
		fireActiveChange();
		analytics.track('workspace_created', { workspace_id: ws.id });
		return ws;
	}

	function onActiveChange(
		cb: (supabase: AppSupabaseClient, workspaceId: string) => void
	) {
		activeChangeListener = cb;
		fireActiveChange();
	}

	async function rename(id: string, name: string) {
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}
		const ws = state.items.find((w) => w.id === id);
		if (!ws) {
			return;
		}
		const previous = ws.name;
		ws.name = trimmed;
		if (!client) {
			return;
		}
		const { error } = await client.from('workspaces').update({ name: trimmed }).eq('id', id);
		if (error) {
			ws.name = previous;
			state.error = error.message;
			throw new Error(error.message);
		}
		analytics.track('workspace_renamed', { workspace_id: id });
	}

	async function remove(id: string) {
		if (!client) {
			return;
		}
		if (state.items.length <= 1) {
			state.error = 'Cannot delete your only workspace.';
			return;
		}
		const previous = state.items;
		state.items = state.items.filter((w) => w.id !== id);
		if (state.activeId === id) {
			state.activeId = state.items[0]?.id ?? null;
			persistActiveId();
		}
		const { error } = await client.from('workspaces').delete().eq('id', id);
		if (error) {
			state.items = previous;
			state.error = error.message;
			return;
		}
		analytics.track('workspace_deleted', { workspace_id: id });
	}

	function reset() {
		client = null;
		currentUserId = null;
		state.items = [];
		state.activeId = null;
		state.loading = false;
		state.error = null;
	}

	return {
		get items() {
			return state.items;
		},
		get activeId() {
			return state.activeId;
		},
		get active(): Workspace | null {
			return state.items.find((w) => w.id === state.activeId) ?? null;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		init,
		reset,
		select,
		add,
		rename,
		remove,
		onActiveChange
	};
}

export const workspaces = createStore();
