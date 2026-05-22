<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import '@excalidraw/excalidraw/index.css';
	import type {
		ExcalidrawProps,
		ExcalidrawImperativeAPI
	} from '@excalidraw/excalidraw/types';
	import { theme } from '$lib/client/modules/theme';
	import type { AppSupabaseClient } from '../../../../../app';
	import { collab, reconcileElements, type Peer } from '../collab.svelte';

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
	};

	let {
		scene = '',
		onChange,
		readOnly = false,
		supabase = null,
		projectId = null,
		userId = null,
		userEmail = null
	}: Props = $props();

	let containerEl: HTMLDivElement | null = $state(null);

	// Resolve 'system' against the OS preference and follow it live.
	let systemPrefersDark = $state(false);
	const resolvedTheme = $derived<'light' | 'dark'>(
		theme.mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme.mode
	);

	let excalAPI: ExcalidrawImperativeAPI | null = null;
	const collabEnabled = $derived(
		!readOnly && !!supabase && !!projectId && !!userId && !!userEmail
	);

	function applyRemoteScene(remoteElements: Parameters<typeof reconcileElements>[0]) {
		if (!excalAPI) {
			return;
		}
		const local = excalAPI.getSceneElementsIncludingDeleted() as unknown as Parameters<
			typeof reconcileElements
		>[0];
		const reconciled = reconcileElements(local, remoteElements);
		// Excalidraw's updateScene expects its full element type; cast since
		// reconcileElements only inspects id/version/versionNonce.
		excalAPI.updateScene({
			elements: reconciled as unknown as Parameters<
				ExcalidrawImperativeAPI['updateScene']
			>[0]['elements']
		});
	}

	function buildCollaboratorsMap(peers: Peer[]) {
		const m = new Map();
		for (const p of peers) {
			m.set(p.id, {
				username: p.name,
				avatarUrl: undefined,
				color: { background: p.color.from, stroke: p.color.to },
				pointer: p.pointer,
				button: p.button,
				selectedElementIds: p.selectedElementIds
			});
		}
		return m;
	}

	onMount(() => {
		let cleanup: (() => void) | null = null;
		let cancelled = false;

		// Track system color scheme so 'system' mode reflects OS changes too.
		let mq: MediaQueryList | null = null;
		let onMqChange: ((e: MediaQueryListEvent) => void) | null = null;
		if (browser && typeof window.matchMedia === 'function') {
			mq = window.matchMedia('(prefers-color-scheme: dark)');
			systemPrefersDark = mq.matches;
			onMqChange = (e) => {
				systemPrefersDark = e.matches;
			};
			mq.addEventListener('change', onMqChange);
		}

		(async () => {
			const [React, { createRoot }, exc] = await Promise.all([
				import('react'),
				import('react-dom/client'),
				import('@excalidraw/excalidraw')
			]);

			if (cancelled || !containerEl) {
				return;
			}

			let initialData: ExcalidrawProps['initialData'] = null;
			if (scene) {
				try {
					const parsed: ExcalidrawProps['initialData'] = JSON.parse(scene);
					initialData = parsed;
				} catch {
					initialData = null;
				}
			}

			const root = createRoot(containerEl);

			let last = scene;
			const handleChange: NonNullable<ExcalidrawProps['onChange']> = (
				elements,
				appState,
				files
			) => {
				if (collabEnabled) {
					collab.broadcastScene(
						elements as unknown as Parameters<typeof reconcileElements>[0]
					);
				}
				const json = exc.serializeAsJSON(elements, appState, files, 'local');
				if (json === last) {
					return;
				}
				last = json;
				onChange?.(json);
			};

			const handlePointerUpdate: NonNullable<ExcalidrawProps['onPointerUpdate']> = (
				payload
			) => {
				if (!collabEnabled) {
					return;
				}
				collab.broadcastPointer(
					payload.pointer,
					payload.button as 'down' | 'up',
					payload.pointersMap
						? undefined
						: undefined /* selection broadcast handled in onChange */
				);
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
				collab.disconnect();
			};
		})();

		return () => {
			cancelled = true;
			if (mq && onMqChange) {
				mq.removeEventListener('change', onMqChange);
			}
			cleanup?.();
		};
	});

	// Push theme changes into Excalidraw's appState via its imperative API.
	// This avoids re-rendering the React tree (which would lose UI state) and
	// only updates the theme.
	$effect(() => {
		const next = resolvedTheme;
		if (excalAPI) {
			excalAPI.updateScene({ appState: { theme: next } });
		}
	});

	// Connect / reconnect to the collaboration channel when the project or
	// user identity changes. Disconnect handled in onMount cleanup.
	$effect(() => {
		if (!collabEnabled || !supabase || !projectId || !userId || !userEmail) {
			collab.disconnect();
			return;
		}
		collab.connect(supabase, projectId, { id: userId, email: userEmail }, {
			onRemoteScene: applyRemoteScene
		});
	});

	// Push the remote-collaborator pointer state into Excalidraw so it draws
	// each peer's cursor. Excalidraw consumes a Map<id, Collaborator>.
	$effect(() => {
		const peers = collab.peers;
		if (excalAPI) {
			excalAPI.updateScene({ collaborators: buildCollaboratorsMap(peers) });
		}
	});
</script>

<div bind:this={containerEl} class="excal-host"></div>

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
