<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Icon from '$lib/client/components/Icon.svelte';
	import type { Project } from '$lib/client/modules/projects';
	import * as B from '../board';
	import TodoNode from './TodoNode.svelte';

	type Props = {
		project: Project;
		saving: boolean;
		onSceneChange: (scene: string) => void;
		onRename: (name: string) => void;
	};
	let { project, saving, onSceneChange, onRename }: Props = $props();

	// The whole board lives in project.scene (JSONB). We hold a reactive copy,
	// mutate it through the pure helpers in board.ts, and stream the serialized
	// result back through onSceneChange (which debounce-saves). The parent keys
	// this component by project id, so a fresh board is parsed per project.
	let board = $state<B.TodoBoard>(untrack(() => B.parseBoard(project.scene)));
	// id of a freshly-created node that should grab focus on next render.
	let focusId = $state<string | null>(null);

	function persist() {
		onSceneChange(B.serializeBoard(board));
	}

	// ----- canvas viewport (pan + zoom) -----
	const MIN_ZOOM = 0.3;
	const MAX_ZOOM = 2.2;
	let viewportEl: HTMLDivElement | null = $state(null);
	let pan = $state({ x: untrack(() => board.viewport.x), y: untrack(() => board.viewport.y) });
	let zoom = $state(untrack(() => board.viewport.zoom));
	let panning = $state(false);
	let draggingCard = $state(false);
	let viewportPersistTimer: ReturnType<typeof setTimeout> | null = null;

	function clamp(value: number, min: number, max: number) {
		return Math.min(max, Math.max(min, value));
	}

	function commitViewport() {
		B.setViewport(board, { x: pan.x, y: pan.y, zoom });
		persist();
	}

	// Pan/zoom fire in bursts; coalesce the saves so we don't serialize on every
	// wheel tick. Position drags persist on pointer-up instead (see below).
	function scheduleViewportSave() {
		if (viewportPersistTimer) {
			clearTimeout(viewportPersistTimer);
		}
		viewportPersistTimer = setTimeout(commitViewport, 400);
	}

	// Wheel handling needs { passive: false } to call preventDefault, so wire it
	// through an attachment rather than an inline handler.
	const canvasWheel: Attachment<HTMLElement> = (el) => {
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				// Pinch / ctrl+wheel → zoom toward the cursor.
				const rect = el.getBoundingClientRect();
				const cx = e.clientX - rect.left;
				const cy = e.clientY - rect.top;
				const prev = zoom;
				const next = clamp(prev * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
				const wx = (cx - pan.x) / prev;
				const wy = (cy - pan.y) / prev;
				pan = { x: cx - wx * next, y: cy - wy * next };
				zoom = next;
			} else {
				// Two-finger / wheel scroll → pan.
				pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
			}
			scheduleViewportSave();
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	};

	// Drag empty canvas to pan. Cards stop propagation, so this only fires on the
	// background.
	function startPan(e: PointerEvent) {
		if (e.button !== 0 || !viewportEl) {
			return;
		}
		// Only pan from empty canvas — clicks that land on a card (its body,
		// inputs, buttons) shouldn't move the view.
		if (e.target instanceof Element && e.target.closest('.card')) {
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
			commitViewport();
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	// Drag a column card by its header. Deltas are divided by zoom so the card
	// tracks the cursor 1:1 in world space regardless of zoom level.
	function startCardDrag(e: PointerEvent, column: B.TodoColumn) {
		if (e.button !== 0) {
			return;
		}
		e.stopPropagation();
		draggingCard = true;
		const startX = e.clientX;
		const startY = e.clientY;
		const originX = column.x;
		const originY = column.y;
		const handle = e.currentTarget;
		if (!(handle instanceof HTMLElement)) {
			return;
		}
		handle.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			column.x = originX + (ev.clientX - startX) / zoom;
			column.y = originY + (ev.clientY - startY) / zoom;
		};
		const up = () => {
			draggingCard = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			persist();
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
	}

	function zoomBy(factor: number) {
		if (!viewportEl) {
			return;
		}
		const rect = viewportEl.getBoundingClientRect();
		const cx = rect.width / 2;
		const cy = rect.height / 2;
		const prev = zoom;
		const next = clamp(prev * factor, MIN_ZOOM, MAX_ZOOM);
		const wx = (cx - pan.x) / prev;
		const wy = (cy - pan.y) / prev;
		pan = { x: cx - wx * next, y: cy - wy * next };
		zoom = next;
		commitViewport();
	}

	// Frame all cards: reset zoom to 1 and pan so the content's top-left sits at
	// a small inset from the viewport origin.
	function resetView() {
		if (board.columns.length === 0) {
			pan = { x: 0, y: 0 };
			zoom = 1;
			commitViewport();
			return;
		}
		const minX = Math.min(...board.columns.map((c) => c.x));
		const minY = Math.min(...board.columns.map((c) => c.y));
		zoom = 1;
		pan = { x: 24 - minX, y: 24 - minY };
		commitViewport();
	}

	// ----- project title rename (mirrors DocProjectView) -----
	let titleEditing = $state(false);
	let titleDraft = $state('');
	let titleInputEl: HTMLInputElement | null = $state(null);

	function startTitleEdit() {
		titleDraft = project.name;
		titleEditing = true;
		queueMicrotask(() => titleInputEl?.select());
	}
	function commitTitleEdit() {
		if (!titleEditing) {
			return;
		}
		titleEditing = false;
		const next = titleDraft.trim();
		if (next && next !== project.name) {
			onRename(next);
		}
	}
	function onTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitTitleEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			titleEditing = false;
		}
	}

	// ----- node operations -----
	const onToggle = (id: string) => {
		B.toggleDone(board, id);
		persist();
	};
	const onText = (id: string, text: string) => {
		B.setText(board, id, text);
		persist();
	};
	const onEnter = (id: string) => {
		const n = B.addSiblingAfter(board, id);
		if (n) {
			focusId = n.id;
		}
		persist();
	};
	const onAddChild = (id: string) => {
		const n = B.addChild(board, id);
		if (n) {
			focusId = n.id;
		}
		persist();
	};
	const onDelete = (id: string) => {
		B.removeNode(board, id);
		persist();
	};
	const onIndent = (id: string) => {
		B.indentNode(board, id);
		focusId = id;
		persist();
	};
	const onOutdent = (id: string) => {
		B.outdentNode(board, id);
		focusId = id;
		persist();
	};
	const onMove = (id: string, dir: -1 | 1) => {
		B.moveNode(board, id, dir);
		persist();
	};
	const onToggleCollapse = (id: string) => {
		B.toggleCollapsed(board, id);
		persist();
	};
	const onToggleKind = (id: string) => {
		B.toggleNodeKind(board, id);
		persist();
	};
	const onFocused = () => {
		focusId = null;
	};

	// ----- column operations -----
	function addTask(columnId: string) {
		const n = B.newTask('');
		B.appendToColumn(board, columnId, n);
		focusId = n.id;
		persist();
	}
	function addSection(columnId: string) {
		const n = B.newSection('');
		B.appendToColumn(board, columnId, n);
		focusId = n.id;
		persist();
	}
	function renameColumn(columnId: string, title: string) {
		B.renameColumn(board, columnId, title);
		persist();
	}
	function removeColumn(columnId: string, title: string) {
		if (board.columns.length === 1) {
			return;
		}
		const label = title.trim() || 'this column';
		if (!confirm(`Delete column "${label}" and all its items?`)) {
			return;
		}
		B.removeColumn(board, columnId);
		persist();
	}
	function addColumn() {
		// Drop the new card at the centre of the current viewport.
		let position: { x: number; y: number } | null = null;
		if (viewportEl) {
			const rect = viewportEl.getBoundingClientRect();
			position = {
				x: (rect.width / 2 - pan.x) / zoom - B.DEFAULT_COLUMN_WIDTH / 2,
				y: (rect.height / 2 - pan.y) / zoom - 40
			};
		}
		B.addColumn(board, position);
		persist();
	}

	const totalProgress = $derived.by(() => {
		const all = board.columns.flatMap((c) => c.nodes);
		return B.countProgress(all);
	});
</script>

<section class="todo">
	<header class="head">
		{#if titleEditing}
			<input
				bind:this={titleInputEl}
				class="title-input"
				bind:value={titleDraft}
				onblur={commitTitleEdit}
				onkeydown={onTitleKeydown}
				maxlength="200"
				aria-label="Project name"
			/>
		{:else}
			<button
				type="button"
				class="title-btn"
				ondblclick={startTitleEdit}
				title="Double-click to rename"
			>
				{project.name}
			</button>
		{/if}

		<div class="head-right">
			{#if totalProgress.total > 0}
				<span class="overall">{totalProgress.done}/{totalProgress.total} done</span>
			{/if}
			<span class="save-pill" class:saving>
				<span class="dot"></span>{saving ? 'Saving' : 'Saved'}
			</span>
			<div class="zoom-group" role="group" aria-label="Zoom">
				<button type="button" class="zoom-btn" title="Zoom out" onclick={() => zoomBy(1 / 1.2)}>
					<Icon name="x" size={13} />
				</button>
				<button type="button" class="zoom-level" title="Reset view" onclick={resetView}>
					{Math.round(zoom * 100)}%
				</button>
				<button type="button" class="zoom-btn" title="Zoom in" onclick={() => zoomBy(1.2)}>
					<Icon name="plus" size={13} />
				</button>
			</div>
			<button type="button" class="add-col-btn" onclick={addColumn}>
				<Icon name="plus" size={13} />
				<span>List</span>
			</button>
		</div>
	</header>

	<div
		class="viewport"
		class:panning
		class:dragging={draggingCard}
		role="application"
		aria-label="Todo list canvas — drag to pan, scroll to move, ctrl/cmd+scroll to zoom"
		bind:this={viewportEl}
		onpointerdown={startPan}
		{@attach canvasWheel}
		style="background-position: {pan.x}px {pan.y}px; background-size: {24 * zoom}px {24 * zoom}px;"
	>
		<div class="world" style="transform: translate({pan.x}px, {pan.y}px) scale({zoom});">
			{#each board.columns as column (column.id)}
				{@const progress = B.countProgress(column.nodes)}
				<div class="card" style="left: {column.x}px; top: {column.y}px; width: {column.width}px;">
					<header
						class="card-head"
						role="button"
						tabindex="-1"
						aria-label="Drag to move list"
						onpointerdown={(e) => startCardDrag(e, column)}
						title="Drag to move"
					>
						<span class="grip" aria-hidden="true"><Icon name="grip" size={13} /></span>
						<input
							class="col-title"
							value={column.title}
							placeholder="List title"
							oninput={(e) => renameColumn(column.id, e.currentTarget.value)}
							onpointerdown={(e) => e.stopPropagation()}
							aria-label="List title"
						/>
						{#if progress.total > 0}
							<span class="col-count">{progress.done}/{progress.total}</span>
						{/if}
						{#if board.columns.length > 1}
							<button
								type="button"
								class="col-del"
								title="Delete list"
								aria-label="Delete list"
								onpointerdown={(e) => e.stopPropagation()}
								onclick={() => removeColumn(column.id, column.title)}
							>
								<Icon name="trash" size={12} />
							</button>
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
							<TodoNode
								{node}
								depth={0}
								{focusId}
								{onFocused}
								{onToggle}
								{onText}
								{onEnter}
								{onAddChild}
								{onDelete}
								{onIndent}
								{onOutdent}
								{onMove}
								{onToggleCollapse}
								{onToggleKind}
							/>
						{/each}
						{#if column.nodes.length === 0}
							<p class="col-empty">No items yet.</p>
						{/if}
					</div>

					<footer class="col-foot">
						<button type="button" class="foot-btn" onclick={() => addTask(column.id)}>
							<Icon name="plus" size={12} /><span>Task</span>
						</button>
						<button type="button" class="foot-btn ghost" onclick={() => addSection(column.id)}>
							<Icon name="list" size={12} /><span>Section</span>
						</button>
					</footer>
				</div>
			{/each}
		</div>

		<span class="canvas-hint">Drag the canvas to pan · scroll to move · ⌘/Ctrl+scroll to zoom</span>
	</div>
</section>

<style>
	.todo {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--surface);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 20px;
		border-bottom: 1px solid var(--border);
		min-height: 48px;
		flex-shrink: 0;
		z-index: 2;
	}
	.title-btn {
		margin: 0;
		padding: 2px 6px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 5px;
		cursor: text;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.title-btn:hover {
		background: var(--accents-1);
	}
	.title-input {
		padding: 2px 6px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--accent, var(--border-strong));
		border-radius: 5px;
		outline: none;
		min-width: 200px;
		max-width: 480px;
	}
	.head-right {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.overall {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-5);
	}
	.save-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--accents-5);
	}
	.save-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--geist-success);
	}
	.save-pill.saving .dot {
		background: var(--geist-warning);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}

	.zoom-group {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 7px;
	}
	.zoom-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 22px;
		padding: 0;
		color: var(--accents-6);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
	}
	.zoom-btn:hover {
		color: var(--geist-foreground);
		background: var(--surface);
	}
	.zoom-level {
		min-width: 42px;
		padding: 0 4px;
		font: inherit;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-6);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
	}
	.zoom-level:hover {
		color: var(--geist-foreground);
		background: var(--surface);
	}
	.add-col-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--geist-background);
		background: var(--geist-foreground);
		border: 1px solid var(--geist-foreground);
		border-radius: 6px;
		cursor: pointer;
	}
	.add-col-btn:hover {
		opacity: 0.9;
	}

	/* ----- canvas ----- */
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
	.viewport.dragging {
		cursor: grabbing;
	}
	.world {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
		/* Zero-size origin so absolutely-positioned cards lay out in world space. */
		width: 0;
		height: 0;
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
		gap: 6px;
		padding: 8px 8px 6px 8px;
		border-bottom: 1px solid var(--border);
		cursor: grab;
	}
	.card-head:active {
		cursor: grabbing;
	}
	.grip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accents-4);
		flex-shrink: 0;
	}
	.card-head:hover .grip {
		color: var(--accents-6);
	}
	.col-title {
		flex: 1;
		min-width: 0;
		padding: 3px 4px;
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 5px;
		outline: none;
		cursor: text;
	}
	.col-title:focus {
		background: var(--accents-1);
		border-color: var(--border);
	}
	.col-title::placeholder {
		color: var(--accents-4);
	}
	.col-count {
		flex-shrink: 0;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-5);
	}
	.col-del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		padding: 0;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
	}
	.col-del:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}

	.col-bar {
		height: 3px;
		margin: 6px 12px 0;
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
		transition: width 200ms ease;
	}

	.nodes {
		padding: 6px 8px;
	}
	.col-empty {
		margin: 6px;
		font-size: 12px;
		color: var(--accents-4);
	}

	.col-foot {
		display: flex;
		gap: 6px;
		padding: 6px 10px 10px;
		border-top: 1px solid var(--border);
	}
	.foot-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 9px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.foot-btn:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
	}
	.foot-btn.ghost {
		background: transparent;
	}

	.canvas-hint {
		position: absolute;
		left: 50%;
		bottom: 12px;
		transform: translateX(-50%);
		padding: 4px 12px;
		font-size: 11px;
		color: var(--accents-5);
		background: color-mix(in srgb, var(--surface) 82%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill, 999px);
		pointer-events: none;
		white-space: nowrap;
	}
</style>
