<script lang="ts">
	import Logo from '$lib/client/components/Logo.svelte';
	import { Whiteboard } from "$lib/client/modules/whiteboard";
	import { formatDate as fmtDate } from '$lib/client/utils/format';

	let { data } = $props();
	const { project, isOwner } = $derived(data);
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
			{:else}
				<span class="readonly-pill">View only</span>
			{/if}
		</div>
	</header>

	<div class="board">
		<Whiteboard scene={project.scene} readOnly />
	</div>
</div>

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
</style>
