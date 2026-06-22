import { browser } from '$app/environment';
import type { AppSupabaseClient } from '../../../../app';
import type { Database, ProjectKind } from '$lib/database.types';
import { analytics } from '../analytics';

export type Visibility = 'private' | 'link';
export type { ProjectKind };

export type Project = {
	id: string;
	name: string;
	kind: ProjectKind;
	scene: string;
	visibility: Visibility;
	/** Public-link expiry (ms epoch). null = no expiry (legacy links only). */
	linkExpiresAt: number | null;
	position: number;
	createdAt: number;
	updatedAt: number;
};

type ProjectRow = Database['public']['Tables']['projects']['Row'];

const POSITION_GAP = 1024;

type StoreState = {
	projects: Project[];
	activeId: string | null;
	loading: boolean;
	error: string | null;
	savingCount: number;
};

const ACTIVE_KEY_PREFIX = 'mindspace::active-project::';
const SAVE_DEBOUNCE_MS = 500;

export function rowToProject(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		kind: row.kind,
		scene: row.scene !== null ? JSON.stringify(row.scene) : '',
		visibility: row.visibility ?? 'private',
		linkExpiresAt: row.link_expires_at ? new Date(row.link_expires_at).getTime() : null,
		position: row.position ?? 0,
		createdAt: new Date(row.created_at).getTime(),
		updatedAt: new Date(row.updated_at).getTime()
	};
}

function compareProjects(a: Project, b: Project): number {
	if (a.position !== b.position) {
		return a.position - b.position;
	}
	// Tiebreaker: most recently updated first, then id for full determinism.
	if (a.updatedAt !== b.updatedAt) {
		return b.updatedAt - a.updatedAt;
	}
	return a.id < b.id ? -1 : 1;
}

function createStore() {
	const state: StoreState = $state({
		projects: [],
		activeId: null,
		loading: false,
		error: null,
		savingCount: 0
	});

	let client: AppSupabaseClient | null = null;
	let currentWorkspaceId: string | null = null;
	let errorListener: ((message: string) => void) | null = null;
	// One-shot active-project preference seeded from the URL on first load. When
	// present and valid it wins over the localStorage fallback, so a reload of
	// `/?p=<id>` reopens that project. Cleared once consumed.
	let initialProjectId: string | null = null;
	const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function activeKey(workspaceId: string) {
		return ACTIVE_KEY_PREFIX + workspaceId;
	}

	// Record an error and notify whoever registered onError. Replaces the
	// page-level $effect that used to poll `error` — failures now push to the
	// UI at the point they happen.
	function fail(message: string) {
		state.error = message;
		errorListener?.(message);
	}

	function onError(cb: (message: string) => void) {
		errorListener = cb;
	}

	async function loadFor(supabase: AppSupabaseClient, workspaceId: string) {
		if (client === supabase && currentWorkspaceId === workspaceId) {
			return;
		}

		flushAllSaves();

		client = supabase;
		currentWorkspaceId = workspaceId;
		state.loading = true;
		state.error = null;

		const { data, error } = await supabase
			.from('projects')
			.select(
				'id, workspace_id, name, kind, scene, visibility, link_expires_at, position, created_at, updated_at'
			)
			.eq('workspace_id', workspaceId)
			.order('position', { ascending: true })
			.order('updated_at', { ascending: false });

		if (error) {
			fail(error.message);
			state.loading = false;
			return;
		}

		state.projects = (data ?? []).map(rowToProject).sort(compareProjects);

		// Restore priority: URL preference > localStorage > first project.
		const preferred = initialProjectId;
		initialProjectId = null;
		if (preferred && state.projects.some((p) => p.id === preferred)) {
			state.activeId = preferred;
			persistActiveId();
		} else if (browser) {
			const stored = localStorage.getItem(activeKey(workspaceId));
			state.activeId =
				stored && state.projects.some((p) => p.id === stored)
					? stored
					: (state.projects[0]?.id ?? null);
		} else {
			state.activeId = state.projects[0]?.id ?? null;
		}

		state.loading = false;
	}

	/**
	 * Seed the active-project preference from the URL before the first load.
	 * Consumed (and cleared) by the next loadFor.
	 */
	function setInitialProject(id: string | null) {
		initialProjectId = id;
	}

	function persistActiveId() {
		if (!browser || !currentWorkspaceId) {
			return;
		}
		if (state.activeId) {
			localStorage.setItem(activeKey(currentWorkspaceId), state.activeId);
		} else {
			localStorage.removeItem(activeKey(currentWorkspaceId));
		}
	}

	async function add(name?: string, kind: ProjectKind = 'whiteboard'): Promise<Project | null> {
		if (!client || !currentWorkspaceId) {
			return null;
		}
		const finalName = name?.trim() || `Untitled ${state.projects.length + 1}`;
		// New projects appear at the top of the list.
		const firstPosition = state.projects[0]?.position ?? POSITION_GAP;
		const newPosition = firstPosition - POSITION_GAP;

		const { data, error } = await client
			.from('projects')
			.insert({
				name: finalName,
				workspace_id: currentWorkspaceId,
				kind,
				scene: null,
				position: newPosition
			})
			.select(
				'id, workspace_id, name, kind, scene, visibility, link_expires_at, position, created_at, updated_at'
			)
			.single();

		if (error || !data) {
			fail(error?.message ?? 'Failed to create project');
			return null;
		}

		const project = rowToProject(data);
		state.projects = [project, ...state.projects];
		state.activeId = project.id;
		persistActiveId();
		analytics.track('project_created', {
			workspace_id: currentWorkspaceId,
			project_id: project.id
		});
		return project;
	}

	/**
	 * Move `id` so it sits at `targetIndex` in the visible list. Computes a new
	 * position as the midpoint between the surrounding items so we never need to
	 * renumber the rest of the list.
	 *
	 * `targetIndex` is interpreted as the index after the move (i.e. 0 = top).
	 */
	async function reorder(id: string, targetIndex: number) {
		const project = state.projects.find((p) => p.id === id);
		if (!project) {
			return;
		}
		const currentIndex = state.projects.indexOf(project);
		if (currentIndex === -1 || currentIndex === targetIndex) {
			return;
		}

		// Build neighbor lookup using the list with the moving item removed,
		// then read the slots around `targetIndex`.
		const without = state.projects.filter((p) => p.id !== id);
		const beforeIdx = targetIndex - 1;
		const before = beforeIdx >= 0 ? without[beforeIdx] : null;
		const after = targetIndex < without.length ? without[targetIndex] : null;

		let newPosition: number;
		if (!before && after) {
			newPosition = after.position - POSITION_GAP;
		} else if (before && !after) {
			newPosition = before.position + POSITION_GAP;
		} else if (before && after) {
			newPosition = (before.position + after.position) / 2;
		} else {
			newPosition = POSITION_GAP; // empty list – shouldn't happen
		}

		const previousPosition = project.position;
		project.position = newPosition;
		state.projects = [...state.projects].sort(compareProjects);

		if (!client) {
			return;
		}

		const { error } = await client.from('projects').update({ position: newPosition }).eq('id', id);

		if (error) {
			project.position = previousPosition;
			state.projects = [...state.projects].sort(compareProjects);
			fail(error.message);
			return;
		}
		analytics.track('project_reordered', { project_id: id });
	}

	async function remove(id: string) {
		if (!client) {
			return;
		}
		const previous = state.projects;
		state.projects = state.projects.filter((p) => p.id !== id);
		if (state.activeId === id) {
			state.activeId = state.projects[0]?.id ?? null;
			persistActiveId();
		}
		clearTimer(id);

		const { error } = await client.from('projects').delete().eq('id', id);
		if (error) {
			state.projects = previous;
			fail(error.message);
			return;
		}
		analytics.track('project_deleted', { project_id: id });
	}

	async function rename(id: string, name: string) {
		if (!client) {
			return;
		}
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}

		const project = state.projects.find((p) => p.id === id);
		if (!project) {
			return;
		}
		const previousName = project.name;
		project.name = trimmed;
		project.updatedAt = Date.now();

		const { error } = await client.from('projects').update({ name: trimmed }).eq('id', id);
		if (error) {
			project.name = previousName;
			fail(error.message);
			return;
		}
		analytics.track('project_renamed', { project_id: id });
	}

	/**
	 * Move a project into another workspace. The project disappears from the
	 * current workspace's list (we're viewing only one workspace at a time) and
	 * gets a fresh position at the top of the destination.
	 */
	async function moveToWorkspace(id: string, destinationWorkspaceId: string) {
		if (destinationWorkspaceId === currentWorkspaceId) {
			return false;
		}
		const project = state.projects.find((p) => p.id === id);
		if (!project) {
			return false;
		}

		// Optimistic local removal — the project no longer belongs in the
		// currently-loaded workspace's list.
		const previous = state.projects;
		const previousActive = state.activeId;
		state.projects = state.projects.filter((p) => p.id !== id);
		if (state.activeId === id) {
			state.activeId = state.projects[0]?.id ?? null;
			persistActiveId();
		}

		if (!client) {
			return true;
		}

		const { error } = await client
			.from('projects')
			.update({ workspace_id: destinationWorkspaceId, position: 0 })
			.eq('id', id);

		if (error) {
			state.projects = previous;
			state.activeId = previousActive;
			persistActiveId();
			fail(error.message);
			return false;
		}
		analytics.track('project_moved_to_workspace', {
			project_id: id,
			to_workspace_id: destinationWorkspaceId
		});
		return true;
	}

	/**
	 * Change visibility. Public links carry an expiry (`linkExpiresAt`, ms
	 * epoch) — required when enabling 'link'; cleared when going private.
	 */
	async function setVisibility(id: string, visibility: Visibility, linkExpiresAt?: number) {
		if (!client) {
			return;
		}
		const project = state.projects.find((p) => p.id === id);
		if (!project) {
			return;
		}
		const previous = project.visibility;
		const previousExpiry = project.linkExpiresAt;
		const expiry = visibility === 'link' ? (linkExpiresAt ?? null) : null;
		project.visibility = visibility;
		project.linkExpiresAt = expiry;
		const { error } = await client
			.from('projects')
			.update({ visibility, link_expires_at: expiry ? new Date(expiry).toISOString() : null })
			.eq('id', id);
		if (error) {
			project.visibility = previous;
			project.linkExpiresAt = previousExpiry;
			fail(error.message);
			return;
		}
		analytics.track('project_visibility_changed', { project_id: id, visibility });
	}

	function select(id: string) {
		if (state.projects.some((p) => p.id === id)) {
			state.activeId = id;
			persistActiveId();
		}
	}

	function clearTimer(id: string) {
		const t = saveTimers.get(id);
		if (t) {
			clearTimeout(t);
			saveTimers.delete(id);
		}
	}

	function flushAllSaves() {
		saveTimers.forEach((t) => clearTimeout(t));
		saveTimers.clear();
	}

	function saveScene(id: string, scene: string) {
		const project = state.projects.find((p) => p.id === id);
		if (!project || !client) {
			return;
		}
		if (project.scene === scene) {
			return;
		}

		project.scene = scene;
		project.updatedAt = Date.now();

		clearTimer(id);
		state.savingCount++;
		const supabase = client;

		const timer = setTimeout(async () => {
			saveTimers.delete(id);
			try {
				let parsed: Database['public']['Tables']['projects']['Update']['scene'] = null;
				try {
					parsed = JSON.parse(scene);
				} catch {
					parsed = null;
				}
				const { error } = await supabase.from('projects').update({ scene: parsed }).eq('id', id);
				if (error) {
					fail(error.message);
				}
			} finally {
				state.savingCount = Math.max(0, state.savingCount - 1);
			}
		}, SAVE_DEBOUNCE_MS);

		saveTimers.set(id, timer);
	}

	function reset() {
		flushAllSaves();
		client = null;
		currentWorkspaceId = null;
		state.projects = [];
		state.activeId = null;
		state.loading = false;
		state.error = null;
		state.savingCount = 0;
	}

	/**
	 * Re-fetch the project list for the current workspace, bypassing the
	 * loadFor early-exit. Preserves the selected project when it still
	 * exists; otherwise falls back to the first project. No-op if nothing
	 * has been loaded yet.
	 */
	async function refresh() {
		if (!client || !currentWorkspaceId) {
			return;
		}
		const ws = currentWorkspaceId;
		const previousActive = state.activeId;
		state.loading = true;
		state.error = null;

		const { data, error } = await client
			.from('projects')
			.select(
				'id, workspace_id, name, kind, scene, visibility, link_expires_at, position, created_at, updated_at'
			)
			.eq('workspace_id', ws)
			.order('position', { ascending: true })
			.order('updated_at', { ascending: false });

		if (error) {
			fail(error.message);
			state.loading = false;
			return;
		}

		state.projects = (data ?? []).map(rowToProject).sort(compareProjects);
		if (previousActive && state.projects.some((p) => p.id === previousActive)) {
			state.activeId = previousActive;
		} else {
			state.activeId = state.projects[0]?.id ?? null;
			persistActiveId();
		}
		state.loading = false;
	}

	return {
		get projects() {
			return state.projects;
		},
		get activeId() {
			return state.activeId;
		},
		get active(): Project | null {
			return state.projects.find((p) => p.id === state.activeId) ?? null;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		get isSaving() {
			return state.savingCount > 0;
		},
		loadFor,
		refresh,
		reset,
		add,
		remove,
		rename,
		reorder,
		select,
		saveScene,
		setVisibility,
		moveToWorkspace,
		setInitialProject,
		onError
	};
}

export const projects = createStore();
