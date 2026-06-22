<script lang="ts">
	import { untrack } from 'svelte';
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
		B.addColumn(board);
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
			<button type="button" class="add-col-btn" onclick={addColumn}>
				<Icon name="plus" size={13} />
				<span>Column</span>
			</button>
		</div>
	</header>

	<div class="board">
		{#each board.columns as column (column.id)}
			{@const progress = B.countProgress(column.nodes)}
			<div class="column">
				<header class="col-head">
					<input
						class="col-title"
						value={column.title}
						placeholder="Column title"
						oninput={(e) => renameColumn(column.id, e.currentTarget.value)}
						aria-label="Column title"
					/>
					{#if progress.total > 0}
						<span class="col-count">{progress.done}/{progress.total}</span>
					{/if}
					{#if board.columns.length > 1}
						<button
							type="button"
							class="col-del"
							title="Delete column"
							aria-label="Delete column"
							onclick={() => removeColumn(column.id, column.title)}
						>
							<Icon name="x" size={13} />
						</button>
					{/if}
				</header>

				{#if progress.total > 0}
					<div class="col-bar">
						<span
							class="col-bar-fill"
							style="width: {progress.total ? (progress.done / progress.total) * 100 : 0}%"
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

		<button type="button" class="add-column" onclick={addColumn} aria-label="Add column">
			<Icon name="plus" size={16} />
			<span>Add column</span>
		</button>
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
		gap: 8px;
		padding: 10px 10px 8px 12px;
		flex-shrink: 0;
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
	}
	.col-title:focus {
		background: var(--surface);
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
		transition: width 200ms ease;
	}

	.nodes {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 2px 8px 8px;
	}
	.col-empty {
		margin: 6px 6px 10px;
		font-size: 12px;
		color: var(--accents-4);
	}

	.col-foot {
		display: flex;
		gap: 6px;
		padding: 8px 10px 10px;
		border-top: 1px solid var(--border);
		flex-shrink: 0;
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
		background: var(--surface);
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

	.add-column {
		flex: 0 0 200px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		align-self: stretch;
		max-height: 96px;
		padding: 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: var(--accents-5);
		background: transparent;
		border: 1px dashed var(--border);
		border-radius: 12px;
		cursor: pointer;
		transition:
			color 120ms,
			border-color 120ms,
			background 120ms;
	}
	.add-column:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-4);
		background: var(--accents-1);
	}
</style>
