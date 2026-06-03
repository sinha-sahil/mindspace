<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import type { Attachment } from 'svelte/attachments';
	import '@excalidraw/excalidraw/index.css';
	import type { ExcalidrawProps, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
	import { theme } from '$lib/client/modules/theme';
	import type { AppSupabaseClient } from '../../../../../app';
	import { collab, reconcileElements, type Peer, type SceneElement } from '../collab.svelte';

	type Props = {
		scene?: string;
		onChange?: (scene: string) => void;
		readOnly?: boolean;
		// Multiplayer is opt-in: caller passes supabase + project + user to
		// enable live cursors and scene sync.
		supabase?: AppSupabaseClient | null;
		projectId?: string | null;
		userId?: string | null;
		userEmail?: string | null;
		// In split view only the focused pane is "live" — non-live panes still
		// render + autosave but don't hold the shared realtime channel.
		live?: boolean;
	};

	let {
		scene = '',
		onChange,
		readOnly = false,
		supabase = null,
		projectId = null,
		userId = null,
		userEmail = null,
		live = true
	}: Props = $props();

	let excalAPI: ExcalidrawImperativeAPI | null = $state(null);

	const prefersDark = new MediaQuery('(prefers-color-scheme: dark)');
	const resolvedTheme = $derived<'light' | 'dark'>(
		theme.mode === 'system' ? (prefersDark.current ? 'dark' : 'light') : theme.mode
	);

	const collabEnabled = $derived(
		!readOnly && live && !!supabase && !!projectId && !!userId && !!userEmail
	);

	function applyRemoteScene(remote: readonly SceneElement[]) {
		if (!excalAPI) {
			return;
		}
		const reconciled = reconcileElements(excalAPI.getSceneElementsIncludingDeleted(), remote);
		excalAPI.updateScene({ elements: reconciled });
	}

	function buildCollaboratorsMap(peers: Peer[]) {
		const map = new Map<string, Record<string, unknown>>();
		for (const p of peers) {
			const collaborator: Record<string, unknown> = {
				id: p.id,
				username: p.name,
				color: { background: p.color.from, stroke: p.color.to }
			};
			if (p.pointer) {
				collaborator.pointer = p.pointer;
			}
			if (p.button) {
				collaborator.button = p.button;
			}
			map.set(p.id, collaborator);
		}
		return map;
	}

	// Mount Excalidraw (a React component) into the host element. An attachment
	// hands us the element directly and runs once for it — the reactive reads in
	// the async body aren't tracked, so this never re-mounts the React tree.
	const mountExcalidraw: Attachment<HTMLElement> = (node) => {
		let cleanup: (() => void) | null = null;
		let cancelled = false;

		(async () => {
			const [React, { createRoot }, exc] = await Promise.all([
				import('react'),
				import('react-dom/client'),
				import('@excalidraw/excalidraw')
			]);

			if (cancelled) {
				return;
			}

			let initialData: ExcalidrawProps['initialData'] = null;
			if (scene) {
				try {
					initialData = JSON.parse(scene);
				} catch {
					initialData = null;
				}
			}

			const root = createRoot(node);

			let last = scene;
			const handleChange: NonNullable<ExcalidrawProps['onChange']> = (
				elements,
				appState,
				files
			) => {
				if (collabEnabled) {
					collab.broadcastScene(elements);
				}
				const json = exc.serializeAsJSON(elements, appState, files, 'local');
				if (json === last) {
					return;
				}
				last = json;
				onChange?.(json);
			};

			const handlePointerUpdate: NonNullable<ExcalidrawProps['onPointerUpdate']> = (payload) => {
				if (!collabEnabled) {
					return;
				}
				collab.broadcastPointer(payload.pointer, payload.button);
			};

			const baseProps: ExcalidrawProps = {
				initialData,
				theme: resolvedTheme,
				viewModeEnabled: readOnly,
				excalidrawAPI: (api: ExcalidrawImperativeAPI) => {
					excalAPI = api;
				},
				UIOptions: { canvasActions: { changeViewBackgroundColor: false } }
			};
			const props: ExcalidrawProps = readOnly
				? baseProps
				: {
						...baseProps,
						onChange: handleChange,
						onPointerUpdate: handlePointerUpdate
					};

			root.render(React.createElement(exc.Excalidraw, props));

			cleanup = () => {
				excalAPI = null;
				root.unmount();
				// Only tear down the channel if it's still ours — another pane
				// may have taken it over.
				if (projectId) {
					collab.leaveProject(projectId);
				}
			};
		})();

		return () => {
			cancelled = true;
			cleanup?.();
		};
	};

	// Attachments: element-bound reactive sync into Excalidraw's imperative API.
	// They re-run whenever the reactive state they read changes — the Svelte 5
	// idiom for wiring an element to a third-party library.

	// Mirror the app theme into Excalidraw without re-rendering the React tree.
	const syncTheme: Attachment = () => {
		const api = excalAPI;
		if (api) {
			api.updateScene({ appState: { theme: resolvedTheme } });
		}
	};

	// Hold the realtime channel while this pane is live. collab.connect()
	// internally swaps channels, so focus moving between split panes hands the
	// channel over cleanly. Teardown happens in the mount cleanup.
	const syncCollab: Attachment = () => {
		if (collabEnabled && supabase && projectId && userId && userEmail) {
			collab.connect(
				supabase,
				projectId,
				{ id: userId, email: userEmail },
				{
					onRemoteScene: applyRemoteScene
				}
			);
		}
	};

	// Draw peers' cursors. A non-live pane clears them — its peers belong to the
	// other pane's project.
	const syncPeers: Attachment = () => {
		const peers = collab.peers;
		const api = excalAPI;
		if (api) {
			api.updateScene({
				collaborators: collabEnabled ? buildCollaboratorsMap(peers) : new Map()
			});
		}
	};
</script>

<div
	class="excal-host"
	{@attach mountExcalidraw}
	{@attach syncTheme}
	{@attach syncCollab}
	{@attach syncPeers}
></div>

<style>
	.excal-host {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
	}

	.excal-host :global(.excalidraw) {
		--color-primary: var(--geist-foreground);
	}
</style>
