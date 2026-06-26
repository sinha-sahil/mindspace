<script lang="ts">
	import Logo from '$lib/client/components/Logo.svelte';
	import MermaidFullscreen from '$lib/client/modules/documents/ui/MermaidFullscreen.svelte';
	import { Whiteboard } from '$lib/client/modules/whiteboard';
	import { TodoReadOnly } from '$lib/client/modules/todos';
	import { SheetReadOnly } from '$lib/client/modules/sheets';
	import { formatDate as fmtDate } from '$lib/client/utils/format';
	import { renderMarkdown, renderMermaidDiagrams } from '$lib/client/modules/documents/markdown';

	let { data } = $props();
	const { project, documents, isOwner, sharedWithYou } = $derived(data);

	let activeDocId = $state<string | null>(null);
	const activeDoc = $derived(documents.find((d) => d.id === activeDocId) ?? documents[0] ?? null);
	const docHtml = $derived(activeDoc ? renderMarkdown(activeDoc.content) : '');

	// The article element isn't remounted when the active doc changes (no {#key}),
	// so re-run mermaid rendering whenever the rendered HTML changes. Reading
	// `docHtml` registers the dependency; the {@html} swap has flushed by the
	// time this effect body runs.
	let docBodyEl: HTMLElement | null = $state(null);
	$effect(() => {
		void docHtml;
		if (docBodyEl) {
			renderMermaidDiagrams(docBodyEl);
		}
	});
</script>

<svelte:head>
	<title>{project.name} · mindspace</title>
</svelte:head>

<div class="public-view">
	<header class="bar">
		<a href="/" class="brand">
			<Logo size={18} />
			<span class="brand-text">mindspace</span>
		</a>
		<div class="title-block">
			<span class="title">{project.name}</span>
			<span class="meta">Updated {fmtDate(project.updatedAt)}</span>
		</div>
		<div class="actions">
			{#if isOwner}
				<a href="/" class="btn-link">Open in app →</a>
			{:else if sharedWithYou}
				<span class="readonly-pill shared">Shared with you</span>
			{:else}
				<span class="readonly-pill">View only</span>
			{/if}
		</div>
	</header>

	{#if project.kind === 'doc'}
		<div class="doc-layout">
			{#if documents.length > 1}
				<nav class="doc-list" aria-label="Documents">
					{#each documents as doc (doc.id)}
						<button
							type="button"
							class="doc-item"
							class:active={doc.id === activeDoc?.id}
							onclick={() => (activeDocId = doc.id)}
						>
							{doc.name}
						</button>
					{/each}
				</nav>
			{/if}
			<div class="doc-content">
				{#if activeDoc}
					<article class="doc-body" bind:this={docBodyEl}>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown -->
						{@html docHtml}
					</article>
				{:else}
					<p class="doc-empty">This project has no documents yet.</p>
				{/if}
			</div>
		</div>
	{:else if project.kind === 'todo'}
		<TodoReadOnly scene={project.scene} />
	{:else if project.kind === 'sheet'}
		<div class="board">
			<SheetReadOnly scene={project.scene} />
		</div>
	{:else}
		<div class="board">
			<Whiteboard scene={project.scene} readOnly />
		</div>
	{/if}
</div>

<MermaidFullscreen />

<style>
	:global(html, body) {
		height: 100%;
	}
	:global(body > div[style*='display: contents']) {
		height: 100%;
	}
	.public-view {
		display: flex;
		flex-direction: column;
		height: 100vh;
		min-height: 0;
		overflow: hidden;
		background: var(--surface);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 20px;
		border-bottom: 1px solid var(--border);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		color: var(--geist-foreground);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.title-block {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		font-size: 11px;
		color: var(--accents-5);
	}
	.readonly-pill {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}
	.readonly-pill.shared {
		color: var(--accent, var(--geist-success));
		border-color: color-mix(in srgb, var(--accent, var(--geist-success)) 40%, transparent);
		background: var(--accent-soft, var(--accents-1));
	}
	.btn-link {
		font-size: 13px;
		color: var(--accents-5);
		text-decoration: none;
	}
	.btn-link:hover {
		color: var(--geist-foreground);
	}
	.board {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	:global(.public-view .board > *) {
		flex: 1;
		min-height: 0;
	}

	/* ---- read-only doc viewer ---- */
	.doc-layout {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.doc-list {
		flex: 0 0 220px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 10px;
		border-right: 1px solid var(--border);
		overflow-y: auto;
	}
	.doc-item {
		padding: 7px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--accents-6);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-item:hover {
		background: var(--accents-1);
		color: var(--geist-foreground);
	}
	.doc-item.active {
		background: var(--accents-1);
		color: var(--geist-foreground);
		font-weight: 500;
	}
	.doc-content {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
	}
	.doc-body {
		max-width: 760px;
		margin: 0 auto;
		padding: 40px 32px 80px;
		font-size: 15px;
		line-height: 1.7;
		color: var(--geist-foreground);
	}
	.doc-body :global(h1),
	.doc-body :global(h2),
	.doc-body :global(h3) {
		letter-spacing: -0.015em;
		line-height: 1.25;
	}
	.doc-body :global(pre) {
		padding: 12px 14px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-size: 13px;
	}
	.doc-body :global(code) {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
	.doc-body :global(pre.mermaid-diagram) {
		position: relative;
		padding: 0;
		background: transparent;
		border: none;
		text-align: center;
	}
	.doc-body :global(pre.mermaid-diagram svg) {
		max-width: 100%;
		height: auto;
	}
	.doc-body :global(.mermaid-fullscreen-btn) {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		color: var(--accents-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--duration-fast, 120ms) var(--ease-out, ease);
	}
	.doc-body :global(pre.mermaid-diagram:hover .mermaid-fullscreen-btn),
	.doc-body :global(.mermaid-fullscreen-btn:focus-visible) {
		opacity: 1;
	}
	.doc-body :global(.mermaid-fullscreen-btn:hover) {
		color: var(--geist-foreground);
		background: var(--accents-1);
	}
	.doc-body :global(.mermaid-fullscreen-btn svg) {
		width: 15px;
		height: 15px;
	}
	.doc-body :global(pre.mermaid-error) {
		text-align: left;
		color: var(--geist-error, #e00);
		white-space: pre-wrap;
	}
	.doc-body :global(blockquote) {
		margin: 0;
		padding: 2px 16px;
		border-left: 3px solid var(--border);
		color: var(--accents-6);
	}
	.doc-body :global(img) {
		max-width: 100%;
	}
	.doc-empty {
		padding: 48px;
		text-align: center;
		font-size: 13px;
		color: var(--accents-5);
	}
</style>
