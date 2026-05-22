import { browser } from '$app/environment';
import type { AppSupabaseClient } from '../../../../app';
import type { Database } from '$lib/database.types';
import { analytics } from '../analytics';

export type Visibility = 'private' | 'link';

export type Project = {
	id: string;
	name: string;
	scene: string;
	visibility: Visibility;
	position: number;
	createdAt: number;
	updatedAt: number;
}

type ProjectRow = Database['public']['Tables']['projects']['Row'];

const POSITION_GAP = 1024;

type StoreState = {
	projects: Project[];
	activeId: string | null;
	loading: boolean;
	error: string | null;
	savingCount: number;
}

const ACTIVE_KEY_PREFIX = 'mindspace::active-project::';
const SAVE_DEBOUNCE_MS = 500;

function rowToProject(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		scene: row.scene !== null ? JSON.stringify(row.scene) : '',
		visibility: row.visibility ?? 'private',
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
	const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function activeKey(workspaceId: string) {
		return ACTIVE_KEY_PREFIX + workspaceId;
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
			.select('id, workspace_id, name, scene, visibility, position, created_at, updated_at')
			.eq('workspace_id', workspaceId)
			.order('position', { ascending: true })
			.order('updated_at', { ascending: false });

		if (error) {
			state.error = error.message;
			state.loading = false;
			return;
		}

		state.projects = (data ?? []).map(rowToProject).sort(compareProjects);

		if (browser) {
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

	async function add(name?: string): Promise<Project | null> {
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
				scene: null,
				position: newPosition
			})
			.select('id, workspace_id, name, scene, visibility, position, created_at, updated_at')
			.single();

		if (error || !data) {
			state.error = error?.message ?? 'Failed to create project';
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

		const { error } = await client
			.from('projects')
			.update({ position: newPosition })
			.eq('id', id);

		if (error) {
			project.position = previousPosition;
			state.projects = [...state.projects].sort(compareProjects);
			state.error = error.message;
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
			state.error = error.message;
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
			state.error = error.message;
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
			state.error = error.message;
			return false;
		}
		analytics.track('project_moved_to_workspace', {
			project_id: id,
			to_workspace_id: destinationWorkspaceId
		});
		return true;
	}

	async function setVisibility(id: string, visibility: Visibility) {
		if (!client) {
			return;
		}
		const project = state.projects.find((p) => p.id === id);
		if (!project) {
			return;
		}
		const previous = project.visibility;
		project.visibility = visibility;
		const { error } = await client.from('projects').update({ visibility }).eq('id', id);
		if (error) {
			project.visibility = previous;
			state.error = error.message;
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
					state.error = error.message;
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
		reset,
		add,
		remove,
		rename,
		reorder,
		select,
		saveScene,
		setVisibility,
		moveToWorkspace
	};
}

export const projects = createStore();
