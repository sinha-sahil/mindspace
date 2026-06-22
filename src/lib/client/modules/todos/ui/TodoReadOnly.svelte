<script lang="ts">
	import Icon from '$lib/client/components/Icon.svelte';
	import { parseBoard, countProgress, type TodoNode } from '../board';

	type Props = {
		/** Serialized board JSON (same shape stored in project.scene). */
		scene: string;
	};
	let { scene }: Props = $props();

	const board = $derived(parseBoard(scene));
</script>

{#snippet renderNode(node: TodoNode, depth: number)}
	<div class="node" class:section={node.kind === 'section'} style="--depth: {depth}">
		<div class="row" class:done={node.kind === 'task' && node.done}>
			{#if node.kind === 'task'}
				<span class="check" class:checked={node.done} aria-hidden="true">
					{#if node.done}<Icon name="check" size={11} strokeWidth={3} />{/if}
				</span>
			{:else}
				<span class="section-mark" aria-hidden="true"></span>
			{/if}
			<span class="text">{node.text || ' '}</span>
		</div>
		{#if node.children.length > 0}
			<div class="children">
				{#each node.children as child (child.id)}
					{@render renderNode(child, depth + 1)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<div class="board">
	{#each board.columns as column (column.id)}
		{@const progress = countProgress(column.nodes)}
		<div class="column">
			<header class="col-head">
				<span class="col-title">{column.title}</span>
				{#if progress.total > 0}
					<span class="col-count">{progress.done}/{progress.total}</span>
				{/if}
			</header>
			{#if progress.total > 0}
				<div class="col-bar">
					<span class="col-bar-fill" style="width: {(progress.done / progress.total) * 100}%"
					></span>
				</div>
			{/if}
			<div class="nodes">
				{#each column.nodes as node (node.id)}
					{@render renderNode(node, 0)}
				{/each}
				{#if column.nodes.length === 0}
					<p class="col-empty">No items.</p>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.board {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 18px 20px;
		overflow-x: auto;
		overflow-y: hidden;
	}
	.column {
		flex: 0 0 320px;
		width: 320px;
		max-height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}
	.col-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 10px 12px 8px;
		flex-shrink: 0;
	}
	.col-title {
		min-width: 0;
		font-size: 13px;
		font-weight: 700;
		color: var(--geist-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.col-count {
		flex-shrink: 0;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-5);
	}
	.col-bar {
		height: 3px;
		margin: 0 12px 6px;
		border-radius: 3px;
		background: var(--accents-2);
		overflow: hidden;
		flex-shrink: 0;
	}
	.col-bar-fill {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--accent, var(--geist-success));
	}
	.nodes {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 2px 12px 12px;
	}
	.col-empty {
		margin: 6px 4px;
		font-size: 12px;
		color: var(--accents-4);
	}

	.node {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 2px;
	}
	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 17px;
		height: 17px;
		flex-shrink: 0;
		color: #fff;
		background: transparent;
		border: 1.5px solid var(--accents-4);
		border-radius: 5px;
	}
	.check.checked {
		background: var(--accent, var(--geist-success));
		border-color: var(--accent, var(--geist-success));
	}
	.section-mark {
		width: 17px;
		flex-shrink: 0;
		text-align: center;
	}
	.section-mark::before {
		content: '';
		display: inline-block;
		width: 4px;
		height: 14px;
		border-radius: 2px;
		background: var(--accent, var(--accents-5));
		vertical-align: middle;
	}
	.text {
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		color: var(--geist-foreground);
		word-break: break-word;
	}
	.row.done .text {
		color: var(--accents-5);
		text-decoration: line-through;
	}
	.section .text {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--accents-6);
	}
	.children {
		margin-left: 16px;
		padding-left: 8px;
		border-left: 1px solid var(--border);
	}
</style>
