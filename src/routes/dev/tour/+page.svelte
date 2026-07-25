<script lang="ts">
	/**
	 * Dev-only harness for the FULL app shell — real Sidebar + real project
	 * views (todo / sheet / whiteboard / doc) on fixture data, so the whole
	 * chrome can be screenshotted and design-audited without auth. Follows the
	 * dev/doc mock pattern: a table-aware in-memory stand-in for the tiny
	 * Supabase surface the stores touch. Guarded: redirects home outside dev.
	 */
	import { onMount } from 'svelte';
	import { dev, browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Icon from '$lib/client/components/Icon.svelte';
	import { Sidebar, sidebar } from '$lib/client/modules/sidebar';
	import { projects } from '$lib/client/modules/projects';
	import { workspaces } from '$lib/client/modules/workspaces';
	import { CommandPalette } from '$lib/client/modules/command-palette';
	import { DocProjectView, documents } from '$lib/client/modules/documents';
	import { TodoProjectView } from '$lib/client/modules/todos';
	import { SheetProjectView } from '$lib/client/modules/sheets';
	import { ProjectPane } from '$lib/client/modules/whiteboard';
	import { serializeBoard, type TodoBoard } from '$lib/client/modules/todos/board';
	import {
		parseBook,
		serializeBook,
		activeSheet,
		setCellRaw
	} from '$lib/client/modules/sheets/model';
	import { theme } from '$lib/client/modules/theme';
	import type { AppSupabaseClient } from '../../../app';

	if (!dev && browser) {
		goto('/');
	}

	/* ---------------- fixtures ---------------- */

	const now = new Date().toISOString();

	function task(
		text: string,
		opts: Partial<{ done: boolean; effort: number; time: number; priority: number }> = {}
	) {
		return {
			id:
				't-' +
				text
					.toLowerCase()
					.replace(/[^a-z]+/g, '-')
					.slice(0, 24),
			kind: 'task',
			text,
			done: opts.done ?? false,
			effort: opts.effort ?? 0,
			time: opts.time ?? 0,
			priority: opts.priority ?? 0,
			collapsed: false,
			children: []
		};
	}

	const board = {
		version: 1,
		columns: [
			{
				id: 'col-launch',
				title: 'Launch prep',
				x: 48,
				y: 40,
				width: null,
				effort: 2,
				time: 1,
				priority: 3,
				nodes: [
					task('Ship invite flow', { done: true }),
					task('Chaos-test resolver at 10k writers', { priority: 3, effort: 3 }),
					task('Draft pricing narrative', { time: 2 }),
					{
						id: 'sec-later',
						kind: 'section',
						text: 'Later',
						done: false,
						effort: 0,
						time: 0,
						priority: 0,
						collapsed: false,
						children: [task('Migrate legacy boards', { effort: 1 })]
					}
				]
			},
			{
				id: 'col-debt',
				title: 'Design debt',
				x: 470,
				y: 96,
				width: null,
				effort: 0,
				time: 0,
				priority: 1,
				nodes: [
					task('Unify button radii', { priority: 2 }),
					task('Audit empty states', { done: true }),
					task('Token pass on modals', { time: 3 })
				]
			}
		],
		viewport: { x: 0, y: 0, zoom: 1 },
		view: { sort: 'manual', hideDone: false }
	};
	// Round-trip through the real serializer so normalizeBoard sees valid input.
	const todoScene = serializeBoard(board as unknown as TodoBoard);

	function sheetScene(): string {
		const book = parseBook(null);
		const s = activeSheet(book);
		const cells: [number, number, string][] = [
			[0, 0, 'Region'],
			[0, 1, 'Q1'],
			[0, 2, 'Q2'],
			[0, 3, 'Total'],
			[1, 0, 'EMEA'],
			[1, 1, '1240'],
			[1, 2, '1560'],
			[1, 3, '=B2+C2'],
			[2, 0, 'APAC'],
			[2, 1, '980'],
			[2, 2, '1130'],
			[2, 3, '=B3+C3'],
			[3, 0, 'Total'],
			[3, 1, '=SUM(B2:B3)'],
			[3, 2, '=SUM(C2:C3)'],
			[3, 3, '=SUM(D2:D3)']
		];
		for (const [r, c, v] of cells) {
			setCellRaw(s, r, c, v);
		}
		return serializeBook(book);
	}

	const DOC = `# Meridian — Q3 Product Brief

Meridian is our **offline-first** sync engine. This brief covers the *why*, the architecture, and the launch checklist — including \`inline code\` and [links](https://example.com).

## Why now

1. **Latency intolerance** — tolerated sync delay dropped under 400ms.
2. **Multiplayer by default** — solo tools get evaluated as team tools.

- [x] Ledger compaction behind flag
- [ ] Chaos-test the resolver
`;

	type ProjectRow = {
		id: string;
		workspace_id: string;
		name: string;
		kind: string;
		/** JSONB in the real DB — rowToProject JSON.stringifies it. */
		scene: unknown;
		visibility: string;
		link_expires_at: string | null;
		position: number;
		created_at: string;
		updated_at: string;
	};

	function projectRow(
		id: string,
		name: string,
		kind: string,
		scene: unknown,
		position: number
	): ProjectRow {
		return {
			id,
			workspace_id: 'ws-dev',
			name,
			kind,
			scene,
			visibility: 'private',
			link_expires_at: null,
			position,
			created_at: now,
			updated_at: now
		};
	}

	const tables: Record<string, unknown[]> = {
		workspaces: [{ id: 'ws-dev', name: 'Personal', owner_id: 'u-dev', created_at: now }],
		projects: [
			projectRow('p-todo', 'Sprint board', 'todo', JSON.parse(todoScene), 0),
			projectRow(
				'p-sheet',
				'Revenue model',
				'sheet',
				browser ? JSON.parse(sheetScene()) : null,
				1024
			),
			projectRow('p-board', 'Architecture sketches', 'whiteboard', null, 2048),
			projectRow('p-doc', 'Q3 Product Brief', 'doc', null, 3072)
		],
		documents: [
			{
				id: 'doc-1',
				project_id: 'p-doc',
				name: 'Q3 Product Brief',
				content: DOC,
				position: 0,
				created_at: now,
				updated_at: now
			}
		]
	};

	/** Table-aware mock of the query-builder surface the stores touch. */
	function mockSupabase(): AppSupabaseClient {
		function selectBuilder(table: string) {
			const rows = () => (tables[table] ?? []).map((r) => ({ ...(r as Record<string, unknown>) }));
			const b = {
				eq: () => b,
				order: () => b,
				single: async () => ({ data: rows()[0] ?? null, error: null }),
				then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
					resolve({ data: rows(), error: null })
			};
			return b;
		}
		const mock = {
			from: (table: string) => ({
				select: () => selectBuilder(table),
				insert: () => ({
					select: () => ({
						single: async () => ({ data: null, error: { message: 'read-only harness' } })
					})
				}),
				update: () => ({ eq: async () => ({ error: null }) }),
				delete: () => ({ eq: async () => ({ error: null }) })
			}),
			channel: () => {
				const ch = {
					on: () => ch,
					subscribe: () => ch,
					unsubscribe: async () => 'ok',
					send: async () => 'ok',
					track: async () => 'ok'
				};
				return ch;
			},
			removeChannel: async () => 'ok'
		};
		return mock as unknown as AppSupabaseClient;
	}

	const supabase = mockSupabase();

	onMount(() => {
		documents.reset();
		workspaces.onActiveChange((sb, wsId) => {
			projects.loadFor(sb, wsId);
		});
		workspaces.init(supabase, 'u-dev');
	});

	const active = $derived(projects.active);

	let isDark = $state(false);
	onMount(() => {
		const attr = document.documentElement.getAttribute('data-theme');
		isDark = attr ? attr === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
	});
	function toggleTheme() {
		theme.set(isDark ? 'light' : 'dark');
		isDark = !isDark;
	}
</script>

<svelte:head>
	<title>tour harness · mindspace dev</title>
</svelte:head>

<div class="harness">
	<header class="bar">
		<span class="crumb">dev / app tour harness</span>
		<button type="button" class="chip" onclick={toggleTheme}>
			<Icon name={isDark ? 'sun' : 'moon'} size={12} />
			<span>{isDark ? 'Light' : 'Dark'}</span>
		</button>
	</header>
	<div class="app" class:topbar={sidebar.topBar}>
		<Sidebar userEmail="dev@mindspace.local" userId="u-dev" isAdmin={false} />
		<main class="pane">
			{#if active?.kind === 'todo'}
				{#key active.id}
					<TodoProjectView
						project={active}
						saving={false}
						onSceneChange={() => {}}
						onRename={() => {}}
					/>
				{/key}
			{:else if active?.kind === 'sheet'}
				{#key active.id}
					<SheetProjectView
						project={active}
						saving={false}
						onSceneChange={() => {}}
						onRename={() => {}}
					/>
				{/key}
			{:else if active?.kind === 'whiteboard'}
				{#key active.id}
					<ProjectPane
						project={active}
						live={false}
						focused={true}
						compact={false}
						supabase={null}
						userId="u-dev"
						userEmail="dev@mindspace.local"
						onFocus={() => {}}
						onSceneChange={() => {}}
						onRename={() => {}}
						onSetVisibility={() => {}}
						saving={false}
					/>
				{/key}
			{:else if active?.kind === 'doc'}
				{#key active.id}
					<DocProjectView projectId={active.id} {supabase} />
				{/key}
			{:else}
				<div class="empty">No active project</div>
			{/if}
		</main>
	</div>
	<CommandPalette isAdmin={false} />
</div>

<style>
	:global(html, body) {
		height: 100%;
	}
	:global(body > div[style*='display: contents']) {
		height: 100%;
	}
	.harness {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 16px;
		border-bottom: 1px solid var(--border);
		min-height: 40px;
	}
	.crumb {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--muted);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 9px;
		font: inherit;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--fg-2);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.app {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.app.topbar {
		flex-direction: column;
	}
	.pane {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
	}
	.pane :global(> *) {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.empty {
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: 13px;
	}
</style>
