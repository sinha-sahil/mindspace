<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Icon from '$lib/client/components/Icon.svelte';
	import {
		parseBoard,
		countProgress,
		viewNodes,
		effectiveColumnWidth,
		type TodoNode
	} from '../board';

	type Props = {
		/** Serialized board JSON (same shape stored in project.scene). */
		scene: string;
	};
	let { scene }: Props = $props();

	const board = $derived(parseBoard(scene));

	// Read-only canvas: pan + zoom to explore, but nothing is editable or
	// draggable. Seed the view from the saved viewport once.
	const MIN_ZOOM = 0.3;
	const MAX_ZOOM = 2.2;
	let viewportEl: HTMLDivElement | null = $state(null);
	let pan = $state(untrack(() => ({ x: board.viewport.x, y: board.viewport.y })));
	let zoom = $state(untrack(() => board.viewport.zoom));
	let panning = $state(false);

	function clamp(v: number, min: number, max: number) {
		return Math.min(max, Math.max(min, v));
	}

	const canvasWheel: Attachment<HTMLElement> = (el) => {
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				const rect = el.getBoundingClientRect();
				const cx = e.clientX - rect.left;
				const cy = e.clientY - rect.top;
				const prev = zoom;
				const next = clamp(prev * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
				pan = { x: cx - ((cx - pan.x) / prev) * next, y: cy - ((cy - pan.y) / prev) * next };
				zoom = next;
			} else {
				pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
			}
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	};

	function startPan(e: PointerEvent) {
		if (e.button !== 0 || !viewportEl) {
			return;
		}
		panning = true;
		const startX = e.clientX;
		const startY = e.clientY;
		const origin = { ...pan };
		const el = viewportEl;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			pan = { x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) };
		};
		const up = () => {
			panning = false;
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}
</script>

{#snippet rating(label: string, level: number, kind: 'effort' | 'time')}
	<span class="rating {kind}" title="{label}: {['—', 'low', 'medium', 'high'][level]}">
		<span class="rk">{label}</span>
		<span class="marks">
			{#each [1, 2, 3] as lvl (lvl)}
				<span class="mark" class:on={level >= lvl}></span>
			{/each}
		</span>
	</span>
{/snippet}

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
			<span class="text">{node.text || ' '}</span>
			{#if node.kind === 'task' && (node.effort > 0 || node.time > 0)}
				<span class="ratings">
					{#if node.effort > 0}{@render rating('E', node.effort, 'effort')}{/if}
					{#if node.time > 0}{@render rating('T', node.time, 'time')}{/if}
				</span>
			{/if}
		</div>
		{#if node.children.length > 0}
			<div class="children">
				{#each viewNodes(node.children, board.view) as child (child.id)}
					{@render renderNode(child, depth + 1)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<div
	class="viewport"
	class:panning
	role="application"
	aria-label="Todo list canvas (read only) — drag to pan, scroll to move"
	bind:this={viewportEl}
	onpointerdown={startPan}
	{@attach canvasWheel}
	style="background-position: {pan.x}px {pan.y}px; background-size: {24 * zoom}px {24 * zoom}px;"
>
	<div class="world" style="transform: translate({pan.x}px, {pan.y}px) scale({zoom});">
		{#each board.columns as column (column.id)}
			{@const progress = countProgress(column.nodes)}
			<div
				class="card"
				style="left: {column.x}px; top: {column.y}px; width: {effectiveColumnWidth(column)}px;"
			>
				<header class="card-head">
					<span class="col-title">{column.title}</span>
					{#if column.effort > 0 || column.time > 0}
						<span class="ratings">
							{#if column.effort > 0}{@render rating('E', column.effort, 'effort')}{/if}
							{#if column.time > 0}{@render rating('T', column.time, 'time')}{/if}
						</span>
					{/if}
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
					{#each viewNodes(column.nodes, board.view) as node (node.id)}
						{@render renderNode(node, 0)}
					{/each}
					{#if column.nodes.length === 0}
						<p class="col-empty">No items.</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.viewport {
		flex: 1;
		min-height: 0;
		position: relative;
		overflow: hidden;
		background-color: var(--bg);
		background-image: radial-gradient(circle, var(--accents-3) 1px, transparent 1px);
		cursor: grab;
		touch-action: none;
	}
	.viewport.panning {
		cursor: grabbing;
	}
	.world {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 0;
		transform-origin: 0 0;
	}

	.card {
		position: absolute;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow-md, 0 8px 30px -12px rgba(0, 0, 0, 0.25));
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 10px 12px 8px;
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
		margin: 0 12px;
		border-radius: 3px;
		background: var(--accents-2);
		overflow: hidden;
	}
	.col-bar-fill {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--accent, var(--geist-success));
	}
	.nodes {
		padding: 6px 12px 12px;
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

	.ratings {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.rating {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 16px;
		padding: 0 5px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 5px;
	}
	.rk {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--accents-6);
	}
	.marks {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.mark {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accents-3);
	}
	.rating.effort .mark.on {
		background: var(--saffron, #e0a106);
	}
	.rating.time .mark.on {
		background: var(--sage, #5f9a6f);
	}
</style>
