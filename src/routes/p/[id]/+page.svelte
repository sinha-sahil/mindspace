<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Logo from '$lib/client/components/Logo.svelte';
	import MermaidFullscreen from '$lib/client/modules/documents/ui/MermaidFullscreen.svelte';
	import { Whiteboard } from '$lib/client/modules/whiteboard';
	import { TodoReadOnly } from '$lib/client/modules/todos';
	import { SheetReadOnly } from '$lib/client/modules/sheets';
	import { formatDate as fmtDate } from '$lib/client/utils/format';
	import { renderMarkdown, enhanceRendered } from '$lib/client/modules/documents/markdown';

	let { data } = $props();
	const { project, documents, isOwner, sharedWithYou } = $derived(data);

	let activeDocId = $state<string | null>(null);
	const activeDoc = $derived(documents.find((d) => d.id === activeDocId) ?? documents[0] ?? null);
	const docHtml = $derived(activeDoc ? renderMarkdown(activeDoc.content) : '');

	// The article element isn't remounted when the active doc changes (no {#key}),
	// so re-run the render upgrades (highlighting, copy buttons, mermaid)
	// whenever the rendered HTML changes. Reading `docHtml` inside the
	// attachment registers the dependency and re-runs it per render; the
	// microtask defers until the {@html} swap has flushed. enhanceRendered is
	// idempotent, so a spurious re-run is harmless.
	const enhanceDocBody: Attachment<HTMLElement> = (node) => {
		void docHtml;
		queueMicrotask(() => enhanceRendered(node));
	};
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
					<article class="doc-body md-body" {@attach enhanceDocBody}>
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
	/* Typography comes from the shared .md-body system (markdown.css);
	   only the page-level measure lives here. */
	.doc-body {
		max-width: 760px;
		margin: 0 auto;
		padding: 40px 32px 80px;
	}
	.doc-empty {
		padding: 48px;
		text-align: center;
		font-size: 13px;
		color: var(--accents-5);
	}
</style>
