<script lang="ts">
	/**
	 * Dev-only harness for the markdown editor + viewer. Mounts the real
	 * components against local state (no Supabase, no auth) so the writing
	 * surface can be iterated on and screenshotted in isolation.
	 * Guarded: redirects home outside `vite dev`.
	 */
	import { onMount } from 'svelte';
	import { dev, browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import Icon from '$lib/client/components/Icon.svelte';
	import MarkdownEditor from '$lib/client/modules/documents/ui/MarkdownEditor.svelte';
	import MarkdownView from '$lib/client/modules/documents/ui/MarkdownView.svelte';
	import MermaidFullscreen from '$lib/client/modules/documents/ui/MermaidFullscreen.svelte';
	import { theme } from '$lib/client/modules/theme';

	if (!dev && browser) {
		goto('/');
	}

	const SAMPLE = `# Meridian — Q3 Product Brief

Meridian is our **offline-first** sync engine for teams that live in spreadsheets but think in documents. This brief covers the *why*, the architecture, and the launch checklist — it exists to exercise ~~every~~ nearly every markdown feature in one place, including \`inline code\`, [links](https://example.com), and footnotes[^1].

> [!NOTE]
> This document is a living spec. Comment on anything that reads wrong — highlights become threads in the panel on the right.

## Why now

The market moved. Three signals convinced us:

1. **Latency intolerance** — median tolerated sync delay dropped under 400ms.
2. **Multiplayer by default** — solo tools get evaluated as team tools.
3. Regulatory pressure on data residency, especially in the EU.

> "The best sync engine is the one nobody notices."
> — every infra engineer, eventually

### Guiding principles

- Local writes are sacred — never block on the network
- Conflicts resolve deterministically, or loudly
- Every byte on the wire earns its place
  - Delta encoding over full snapshots
  - Column-aware compression for tabular payloads

## Architecture

The engine splits into three planes. The mermaid diagram renders below:

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
- [ ] Dogfood week with the analytics team

---

## Appendix

Footnotes, a divider above, and a horizontal-scroll table live here for rendering QA. The full RFC index is on the [internal wiki](https://example.com/wiki).

[^1]: Footnotes render at the bottom with a back-reference link.
`;

	let content = $state(SAMPLE);
	let mode = $state<'view' | 'edit'>('edit');
	let saved = $state(true);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function onChange(next: string) {
		content = next;
		saved = false;
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
		}
		saveTimer = setTimeout(() => (saved = true), 600);
	}

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
	<title>markdown harness · mindspace dev</title>
</svelte:head>

<div class="harness">
	<header class="bar">
		<span class="crumb">dev / markdown harness</span>
		<div class="right">
			<button type="button" class="chip" onclick={toggleTheme}>
				<Icon name={isDark ? 'sun' : 'moon'} size={12} />
				<span>{isDark ? 'Light' : 'Dark'}</span>
			</button>
			<span class="save-pill" class:saving={!saved}>
				<span class="dot"></span>{saved ? 'Saved' : 'Saving'}
			</span>
			<div class="mode-toggle" role="tablist" aria-label="View mode">
				<button
					type="button"
					class="mode-btn"
					class:active={mode === 'view'}
					role="tab"
					aria-selected={mode === 'view'}
					onclick={() => (mode = 'view')}
				>
					<Icon name="eye" size={12} />
					<span>Read</span>
				</button>
				<button
					type="button"
					class="mode-btn"
					class:active={mode === 'edit'}
					role="tab"
					aria-selected={mode === 'edit'}
					onclick={() => (mode = 'edit')}
				>
					<Icon name="pencil" size={12} />
					<span>Edit</span>
				</button>
			</div>
		</div>
	</header>

	<div class="body">
		{#key mode}
			{#if mode === 'view'}
				<MarkdownView
					documentId="dev-doc"
					{content}
					{onChange}
					onRequestEdit={() => (mode = 'edit')}
				/>
			{:else}
				<MarkdownEditor {content} {onChange} onSave={() => (saved = true)} />
			{/if}
		{/key}
	</div>
</div>

<MermaidFullscreen />

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
		padding: 8px 16px;
		border-bottom: 1px solid var(--border);
		min-height: 46px;
		background: var(--surface);
	}
	.crumb {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--muted);
	}
	.right {
		display: flex;
		align-items: center;
		gap: 12px;
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
	.chip:hover {
		color: var(--fg);
		border-color: var(--border-strong);
	}
	.save-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
	}
	.save-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--sage);
	}
	.save-pill.saving .dot {
		background: var(--saffron);
	}
	.mode-toggle {
		display: inline-flex;
		padding: 2px;
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.mode-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 10px;
		font: inherit;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--fg-2);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	.mode-btn.active {
		color: var(--fg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
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
