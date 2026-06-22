import type { AppSupabaseClient } from '../../../../app';
import type { Database } from '$lib/database.types';
import { rowToProject, type Project, type Visibility } from './store.svelte';

const SAVE_DEBOUNCE_MS = 500;

/**
 * Loads + autosaves a single project by id, independent of which workspace
 * is "active" in the projects store. Used by split-view panes that may show
 * a project from a different workspace than the one the sidebar is on.
 *
 * Supabase RLS already allows reading/writing any project in a workspace
 * the caller is a member of, so the project id is all we need — no workspace
 * id parameter, and the session doesn't touch the global projects store.
 *
 * One session per pane mount. The parent uses `{#key projectId}` so the
 * session is replaced (not mutated) when the pane's project changes.
 */
export type ProjectSession = ReturnType<typeof createProjectSession>;

export function createProjectSession(supabase: AppSupabaseClient, projectId: string) {
	const state = $state<{
		project: Project | null;
		loading: boolean;
		error: string | null;
		savingCount: number;
	}>({
		project: null,
		loading: true,
		error: null,
		savingCount: 0
	});

	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;

	(async () => {
		const { data, error } = await supabase
			.from('projects')
			.select(
				'id, workspace_id, name, kind, scene, visibility, link_expires_at, position, created_at, updated_at'
			)
			.eq('id', projectId)
			.single();
		if (destroyed) {
			return;
		}
		if (error || !data) {
			state.error = error?.message ?? 'Project not found';
			state.loading = false;
			return;
		}
		state.project = rowToProject(data);
		state.loading = false;
	})();

	function saveScene(scene: string) {
		const project = state.project;
		if (!project || project.scene === scene) {
			return;
		}
		project.scene = scene;
		project.updatedAt = Date.now();

		if (saveTimer) {
			clearTimeout(saveTimer);
		}
		state.savingCount++;

		saveTimer = setTimeout(async () => {
			saveTimer = null;
			try {
				let parsed: Database['public']['Tables']['projects']['Update']['scene'] = null;
				try {
					parsed = JSON.parse(scene);
				} catch {
					parsed = null;
				}
				const { error } = await supabase
					.from('projects')
					.update({ scene: parsed })
					.eq('id', projectId);
				if (error) {
					state.error = error.message;
				}
			} finally {
				state.savingCount = Math.max(0, state.savingCount - 1);
			}
		}, SAVE_DEBOUNCE_MS);
	}

	async function rename(name: string) {
		const project = state.project;
		if (!project) {
			return;
		}
		const trimmed = name.trim();
		if (!trimmed || trimmed === project.name) {
			return;
		}
		const previous = project.name;
		project.name = trimmed;
		project.updatedAt = Date.now();
		const { error } = await supabase.from('projects').update({ name: trimmed }).eq('id', projectId);
		if (error) {
			project.name = previous;
			state.error = error.message;
		}
	}

	async function setVisibility(v: Visibility, linkExpiresAt?: number) {
		const project = state.project;
		if (!project) {
			return;
		}
		const previous = project.visibility;
		const previousExpiry = project.linkExpiresAt;
		const expiry = v === 'link' ? (linkExpiresAt ?? null) : null;
		project.visibility = v;
		project.linkExpiresAt = expiry;
		const { error } = await supabase
			.from('projects')
			.update({ visibility: v, link_expires_at: expiry ? new Date(expiry).toISOString() : null })
			.eq('id', projectId);
		if (error) {
			project.visibility = previous;
			project.linkExpiresAt = previousExpiry;
			state.error = error.message;
		}
	}

	function destroy() {
		destroyed = true;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
	}

	return {
		get project() {
			return state.project;
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
		saveScene,
		rename,
		setVisibility,
		destroy
	};
}
