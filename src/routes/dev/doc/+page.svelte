<script lang="ts">
	/**
	 * Dev-only harness for the FULL document project view (file rail + header
	 * chrome + editor/viewer + comments panel), backed by an in-memory mock of
	 * the tiny Supabase surface the documents store touches. No auth, no
	 * network. Guarded: redirects home outside `vite dev`.
	 */
	import { onMount } from 'svelte';
	import { dev, browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Icon from '$lib/client/components/Icon.svelte';
	import { DocProjectView, documents } from '$lib/client/modules/documents';
	import { theme } from '$lib/client/modules/theme';
	import type { AppSupabaseClient } from '../../../app';

	if (!dev && browser) {
		goto('/');
	}

	const SAMPLE = `# Meridian — Q3 Product Brief

Meridian is our **offline-first** sync engine for teams that live in spreadsheets but think in documents. This brief covers the *why*, the architecture, and the launch checklist — including \`inline code\`, [links](https://example.com), and footnotes[^1].

> [!NOTE]
> This document is a living spec. Comment on anything that reads wrong — highlights become threads in the panel on the right.

## Why now

The market moved. Three signals convinced us:

1. **Latency intolerance** — median tolerated sync delay dropped under 400ms.
2. **Multiplayer by default** — solo tools get evaluated as team tools.
3. Regulatory pressure on data residency, especially in the EU.

### Guiding principles

- Local writes are sacred — never block on the network
- Conflicts resolve deterministically, or loudly
- Every byte on the wire earns its place
  - Delta encoding over full snapshots
  - Column-aware compression for tabular payloads

## Architecture

\`\`\`mermaid
flowchart LR
  A[Client cache] -->|deltas| B(Sync gateway)
  B --> C{Conflict?}
  C -->|no| D[(Ledger)]
  C -->|yes| E[Resolver]
  E --> D
  D -->|fanout| F[Peers]
\`\`\`

### Write path

\`\`\`ts
export async function commit(delta: Delta): Promise<Receipt> {
  const clock = vectorClock.tick(nodeId);
  const entry = { delta, clock, checksum: xxhash(delta) };
  await ledger.append(entry); // local-first, durable
  return gateway.push(entry).catch(queueForRetry);
}
\`\`\`

### Comparison

| Engine | Model | Offline | Conflict story |
| ------ | ----- | :-----: | -------------- |
| Meridian | CRDT hybrid | ✅ | Deterministic merge |
| LiveWire | OT | ⚠️ partial | Server arbitration |
| SyncKit | Last-write-wins | ✅ | Silent data loss |

> [!WARNING]
> LWW comparisons in vendor benchmarks hide tombstone growth. Always ask for the 90-day storage curve.

## Launch checklist

- [x] Ledger compaction shipping behind flag
- [x] EU data-residency review signed off
- [ ] Chaos-test the resolver at 10k concurrent writers
- [ ] Draft the pricing page narrative

---

[^1]: Footnotes render at the bottom with a back-reference link.
`;

	const ROADMAP = `# Rollout roadmap

## Phase 1 — Internal dogfood

- [x] Analytics team migrated
- [ ] Support team migrated

## Phase 2 — Design partners

Ten teams, hand-held onboarding, weekly syncs.

## Phase 3 — GA

> [!TIP]
> Gate GA on the chaos-test results, not the calendar.
`;

	type Row = {
		id: string;
		project_id: string;
		name: string;
		content: string;
		position: number;
		created_at: string;
		updated_at: string;
	};
	const now = new Date().toISOString();
	const rows: Row[] = [
		{
			id: 'doc-1',
			project_id: 'dev-project',
			name: 'Q3 Product Brief',
			content: SAMPLE,
			position: 0,
			created_at: now,
			updated_at: now
		},
		{
			id: 'doc-2',
			project_id: 'dev-project',
			name: 'Rollout roadmap',
			content: ROADMAP,
			position: 1024,
			created_at: now,
			updated_at: now
		}
	];

	/** The minimal query-builder surface the documents store touches. */
	function mockSupabase(): AppSupabaseClient {
		function selectBuilder() {
			const b = {
				eq: () => b,
				order: () => b,
				single: async () => ({ data: rows[0], error: null }),
				then: (resolve: (v: { data: Row[]; error: null }) => void) =>
					resolve({ data: [...rows], error: null })
			};
			return b;
		}
		const mock = {
			from: () => ({
				select: () => selectBuilder(),
				insert: (row: Partial<Row>) => ({
					select: () => ({
						single: async () => {
							const created: Row = {
								id: `doc-${rows.length + 1}`,
								project_id: 'dev-project',
								name: row.name ?? 'Untitled.md',
								content: row.content ?? '',
								position: row.position ?? 0,
								created_at: new Date().toISOString(),
								updated_at: new Date().toISOString()
							};
							rows.push(created);
							return { data: created, error: null };
						}
					})
				}),
				update: () => ({ eq: async () => ({ error: null }) }),
				delete: () => ({ eq: async () => ({ error: null }) })
			})
		};
		return mock as unknown as AppSupabaseClient;
	}

	// A fresh store load per visit (the module store is a singleton).
	documents.reset();
	const supabase = mockSupabase();

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
	<title>doc harness · mindspace dev</title>
</svelte:head>

<div class="harness">
	<header class="bar">
		<span class="crumb">dev / doc project harness</span>
		<button type="button" class="chip" onclick={toggleTheme}>
			<Icon name={isDark ? 'sun' : 'moon'} size={12} />
			<span>{isDark ? 'Light' : 'Dark'}</span>
		</button>
	</header>
	<div class="body">
		<DocProjectView projectId="dev-project" {supabase} />
	</div>
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
		background: var(--surface);
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
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.body :global(> *) {
		flex: 1;
		min-height: 0;
	}
</style>
