import type { AppSupabaseClient } from '../../../../app';
import type { DocumentRow } from '$lib/database.types';

export type DocumentFile = {
	id: string;
	projectId: string;
	name: string;
	content: string;
	position: number;
	createdAt: number;
	updatedAt: number;
};

const SAVE_DEBOUNCE_MS = 500;

function rowToDocument(row: DocumentRow): DocumentFile {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		content: row.content,
		position: row.position ?? 0,
		createdAt: new Date(row.created_at).getTime(),
		updatedAt: new Date(row.updated_at).getTime()
	};
}

function createStore() {
	const state = $state<{
		items: DocumentFile[];
		activeId: string | null;
		loading: boolean;
		error: string | null;
		savingCount: number;
		currentProjectId: string | null;
	}>({
		items: [],
		activeId: null,
		loading: false,
		error: null,
		savingCount: 0,
		currentProjectId: null
	});

	let client: AppSupabaseClient | null = null;
	// One-shot active-document preference seeded from the URL, keyed by project.
	// Honoured by loadFor so a reload of `/?p=<proj>&d=<doc>` reopens that doc.
	const initialDocByProject = new Map<string, string>();
	const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	async function loadFor(supabase: AppSupabaseClient, projectId: string) {
		if (client === supabase && state.currentProjectId === projectId) {
			return;
		}
		flushAllSaves();
		client = supabase;
		state.currentProjectId = projectId;
		state.loading = true;
		state.error = null;

		const { data, error } = await supabase
			.from('documents')
			.select('id, project_id, name, content, position, created_at, updated_at')
			.eq('project_id', projectId)
			.order('position', { ascending: true })
			.order('created_at', { ascending: true });

		if (error) {
			state.error = error.message;
			state.loading = false;
			return;
		}

		state.items = (data ?? []).map(rowToDocument);
		const preferred = initialDocByProject.get(projectId);
		initialDocByProject.delete(projectId);
		state.activeId =
			preferred && state.items.some((d) => d.id === preferred)
				? preferred
				: (state.items[0]?.id ?? null);
		state.loading = false;
	}

	/**
	 * Seed the active-document preference for a project from the URL before its
	 * first load. Consumed (and cleared) by the next loadFor for that project.
	 */
	function setInitialDoc(projectId: string, docId: string) {
		initialDocByProject.set(projectId, docId);
	}

	async function add(name?: string): Promise<DocumentFile | null> {
		if (!client || !state.currentProjectId) {
			return null;
		}
		const finalName = name?.trim() || `Untitled ${state.items.length + 1}.md`;
		const lastPosition = state.items[state.items.length - 1]?.position ?? -1;

		const { data, error } = await client
			.from('documents')
			.insert({
				project_id: state.currentProjectId,
				name: finalName,
				content: '',
				position: lastPosition + 1024
			})
			.select('id, project_id, name, content, position, created_at, updated_at')
			.single();

		if (error || !data) {
			state.error = error?.message ?? 'Failed to create document';
			return null;
		}

		const doc = rowToDocument(data);
		state.items = [...state.items, doc];
		state.activeId = doc.id;
		return doc;
	}

	async function remove(id: string) {
		if (!client) {
			return;
		}
		clearTimer(id);
		const previous = state.items;
		state.items = state.items.filter((d) => d.id !== id);
		if (state.activeId === id) {
			state.activeId = state.items[0]?.id ?? null;
		}
		const { error } = await client.from('documents').delete().eq('id', id);
		if (error) {
			state.items = previous;
			state.error = error.message;
		}
	}

	async function rename(id: string, name: string) {
		const trimmed = name.trim();
		if (!client || !trimmed) {
			return;
		}
		const doc = state.items.find((d) => d.id === id);
		if (!doc) {
			return;
		}
		const previous = doc.name;
		doc.name = trimmed;
		const { error } = await client.from('documents').update({ name: trimmed }).eq('id', id);
		if (error) {
			doc.name = previous;
			state.error = error.message;
		}
	}

	function saveContent(id: string, content: string) {
		const doc = state.items.find((d) => d.id === id);
		if (!doc || !client || doc.content === content) {
			return;
		}
		doc.content = content;
		doc.updatedAt = Date.now();

		clearTimer(id);
		state.savingCount++;
		const supabase = client;

		const timer = setTimeout(async () => {
			saveTimers.delete(id);
			try {
				const { error } = await supabase.from('documents').update({ content }).eq('id', id);
				if (error) {
					state.error = error.message;
				}
			} finally {
				state.savingCount = Math.max(0, state.savingCount - 1);
			}
		}, SAVE_DEBOUNCE_MS);

		saveTimers.set(id, timer);
	}

	/**
	 * Persist a pending debounced save for `id` right now (Cmd+S). No-op when
	 * nothing is queued. The savingCount slot claimed by saveContent is
	 * released here instead of in its timer.
	 */
	async function flushSave(id: string): Promise<void> {
		const timer = saveTimers.get(id);
		if (!timer || !client) {
			return;
		}
		clearTimeout(timer);
		saveTimers.delete(id);
		const doc = state.items.find((d) => d.id === id);
		try {
			if (doc) {
				const { error } = await client
					.from('documents')
					.update({ content: doc.content })
					.eq('id', id);
				if (error) {
					state.error = error.message;
				}
			}
		} finally {
			state.savingCount = Math.max(0, state.savingCount - 1);
		}
	}

	function select(id: string) {
		if (state.items.some((d) => d.id === id)) {
			state.activeId = id;
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

	function reset() {
		flushAllSaves();
		client = null;
		state.currentProjectId = null;
		state.items = [];
		state.activeId = null;
		state.loading = false;
		state.error = null;
		state.savingCount = 0;
	}

	/**
	 * Re-fetch the document list for the current project, bypassing the
	 * loadFor early-exit. Preserves the active document if it still
	 * exists; otherwise falls back to the first. No-op if nothing has
	 * been loaded yet.
	 */
	async function refresh() {
		if (!client || !state.currentProjectId) {
			return;
		}
		const projectId = state.currentProjectId;
		const previousActive = state.activeId;
		state.loading = true;
		state.error = null;

		const { data, error } = await client
			.from('documents')
			.select('id, project_id, name, content, position, created_at, updated_at')
			.eq('project_id', projectId)
			.order('position', { ascending: true })
			.order('created_at', { ascending: true });

		if (error) {
			state.error = error.message;
			state.loading = false;
			return;
		}

		state.items = (data ?? []).map(rowToDocument);
		state.activeId =
			previousActive && state.items.some((d) => d.id === previousActive)
				? previousActive
				: (state.items[0]?.id ?? null);
		state.loading = false;
	}

	return {
		get items() {
			return state.items;
		},
		get activeId() {
			return state.activeId;
		},
		get active(): DocumentFile | null {
			return state.items.find((d) => d.id === state.activeId) ?? null;
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
		add,
		remove,
		rename,
		saveContent,
		flushSave,
		select,
		setInitialDoc,
		reset
	};
}

export const documents = createStore();
