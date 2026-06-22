<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Icon from '$lib/client/components/Icon.svelte';
	import { countProgress, viewNodes, type TodoNode, type TodoView } from '../board';
	import Self from './TodoNode.svelte';

	type Props = {
		node: TodoNode;
		depth: number;
		view: TodoView;
		focusId: string | null;
		onFocused: () => void;
		onToggle: (id: string) => void;
		onText: (id: string, text: string) => void;
		onEnter: (id: string) => void;
		onAddChild: (id: string) => void;
		onDelete: (id: string) => void;
		onIndent: (id: string) => void;
		onOutdent: (id: string) => void;
		onMove: (id: string, dir: -1 | 1) => void;
		onToggleCollapse: (id: string) => void;
		onToggleKind: (id: string) => void;
		onCycleEffort: (id: string) => void;
		onCycleTime: (id: string) => void;
	};

	let {
		node,
		depth,
		view,
		focusId,
		onFocused,
		onToggle,
		onText,
		onEnter,
		onAddChild,
		onDelete,
		onIndent,
		onOutdent,
		onMove,
		onToggleCollapse,
		onToggleKind,
		onCycleEffort,
		onCycleTime
	}: Props = $props();

	const EFFORT_LABELS = ['Set effort', 'Low effort', 'Medium effort', 'High effort'];
	const TIME_LABELS = ['Set time', 'Quick', 'Medium time', 'Long'];

	const childrenToShow = $derived(viewNodes(node.children, view));

	// When the parent hands us focus (after an add/indent), grab it. Attachments
	// are the sanctioned reactive primitive here — they re-run when the values
	// they read (focusId, node.id) change. We clear the request from the input's
	// own onfocus handler rather than mutating state inside the attachment.
	const grabFocus: Attachment = (el) => {
		if (focusId === node.id && el instanceof HTMLInputElement) {
			el.focus();
		}
	};

	const hasChildren = $derived(node.children.length > 0);
	const progress = $derived(hasChildren ? countProgress(node.children) : { done: 0, total: 0 });

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			if (e.metaKey || e.ctrlKey) {
				e.preventDefault();
				if (node.kind === 'task') {
					onToggle(node.id);
				}
				return;
			}
			e.preventDefault();
			onEnter(node.id);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				onOutdent(node.id);
			} else {
				onIndent(node.id);
			}
		} else if (e.key === 'Backspace' && node.text === '') {
			e.preventDefault();
			onDelete(node.id);
		} else if ((e.altKey || e.metaKey) && e.key === 'ArrowUp') {
			e.preventDefault();
			onMove(node.id, -1);
		} else if ((e.altKey || e.metaKey) && e.key === 'ArrowDown') {
			e.preventDefault();
			onMove(node.id, 1);
		}
	}
</script>

<div class="node" class:section={node.kind === 'section'} style="--depth: {depth}">
	<div class="row" class:done={node.kind === 'task' && node.done}>
		<button
			type="button"
			class="twisty"
			class:hidden={!hasChildren}
			class:collapsed={node.collapsed}
			aria-label={node.collapsed ? 'Expand' : 'Collapse'}
			onclick={() => onToggleCollapse(node.id)}
		>
			<Icon name="chevron-right" size={12} />
		</button>

		{#if node.kind === 'task'}
			<button
				type="button"
				class="check"
				class:checked={node.done}
				role="checkbox"
				aria-checked={node.done}
				aria-label={node.done ? 'Mark not done' : 'Mark done'}
				onclick={() => onToggle(node.id)}
			>
				{#if node.done}<Icon name="check" size={11} strokeWidth={3} />{/if}
			</button>
		{:else}
			<span class="section-mark" aria-hidden="true"></span>
		{/if}

		<input
			{@attach grabFocus}
			class="text"
			value={node.text}
			placeholder={node.kind === 'section' ? 'Section title' : 'To-do…'}
			oninput={(e) => onText(node.id, e.currentTarget.value)}
			onkeydown={onKeydown}
			onfocus={onFocused}
			aria-label={node.kind === 'section' ? 'Section title' : 'To-do item'}
		/>

		{#if hasChildren && node.collapsed && progress.total > 0}
			<span class="count">{progress.done}/{progress.total}</span>
		{/if}

		{#if node.kind === 'task'}
			<div class="ratings">
				<button
					type="button"
					class="rating effort"
					class:set={node.effort > 0}
					title={EFFORT_LABELS[node.effort]}
					aria-label={EFFORT_LABELS[node.effort]}
					onclick={() => onCycleEffort(node.id)}
				>
					<span class="rk">E</span>
					<span class="bars">
						{#each [1, 2, 3] as lvl (lvl)}
							<span class="bar b{lvl}" class:on={node.effort >= lvl}></span>
						{/each}
					</span>
				</button>
				<button
					type="button"
					class="rating time"
					class:set={node.time > 0}
					title={TIME_LABELS[node.time]}
					aria-label={TIME_LABELS[node.time]}
					onclick={() => onCycleTime(node.id)}
				>
					<span class="rk">T</span>
					<span class="dots">
						{#each [1, 2, 3] as lvl (lvl)}
							<span class="dot" class:on={node.time >= lvl}></span>
						{/each}
					</span>
				</button>
			</div>
		{/if}

		<div class="actions">
			<button
				type="button"
				class="act"
				title={node.kind === 'task' ? 'Make section heading' : 'Make to-do item'}
				aria-label="Toggle item type"
				onclick={() => onToggleKind(node.id)}
			>
				<Icon name={node.kind === 'task' ? 'list' : 'check'} size={12} />
			</button>
			<button
				type="button"
				class="act"
				title="Add sub-item"
				aria-label="Add sub-item"
				onclick={() => onAddChild(node.id)}
			>
				<Icon name="plus" size={12} />
			</button>
			<button
				type="button"
				class="act danger"
				title="Delete"
				aria-label="Delete item"
				onclick={() => onDelete(node.id)}
			>
				<Icon name="trash" size={11} />
			</button>
		</div>
	</div>

	{#if hasChildren && !node.collapsed}
		<div class="children">
			{#each childrenToShow as child (child.id)}
				<Self
					node={child}
					depth={depth + 1}
					{view}
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
					{onCycleEffort}
					{onCycleTime}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.node {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: 6px;
		transition: background 100ms;
	}
	.row:hover {
		background: var(--accents-1);
	}

	.twisty {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		padding: 0;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: transform 120ms ease;
		transform: rotate(90deg);
	}
	.twisty.collapsed {
		transform: rotate(0deg);
	}
	.twisty.hidden {
		visibility: hidden;
		pointer-events: none;
	}
	.twisty:hover {
		color: var(--geist-foreground);
		background: var(--accents-2);
	}

	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 17px;
		height: 17px;
		flex-shrink: 0;
		padding: 0;
		color: #fff;
		background: transparent;
		border: 1.5px solid var(--accents-4);
		border-radius: 5px;
		cursor: pointer;
		transition:
			background 120ms,
			border-color 120ms;
	}
	.check:hover {
		border-color: var(--accent, var(--geist-foreground));
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
		padding: 3px 4px;
		font: inherit;
		font-size: 13.5px;
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		outline: none;
	}
	.text:focus {
		background: var(--surface);
		border-color: var(--border);
	}
	.text::placeholder {
		color: var(--accents-4);
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

	.count {
		flex-shrink: 0;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-5);
		padding: 0 4px;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 1px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 100ms;
	}
	.row:hover .actions,
	.text:focus ~ .actions {
		opacity: 1;
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
	}
	.act:hover {
		color: var(--geist-foreground);
		background: var(--accents-2);
	}
	.act.danger:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}

	/* ----- effort / time "ticket" ratings ----- */
	.ratings {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.rating {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 18px;
		padding: 0 5px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 5px;
		cursor: pointer;
		/* Unset chips stay out of the way until you hover the row. */
		opacity: 0;
		transition:
			opacity 100ms,
			border-color 100ms;
	}
	.rating.set {
		opacity: 1;
	}
	.row:hover .rating {
		opacity: 1;
	}
	.rating:hover {
		border-color: var(--accents-4);
	}
	.rk {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--accents-5);
	}
	.rating.set .rk {
		color: var(--accents-6);
	}

	/* effort = ascending bars */
	.bars {
		display: inline-flex;
		align-items: flex-end;
		gap: 1px;
		height: 10px;
	}
	.bar {
		width: 2.5px;
		border-radius: 1px;
		background: var(--accents-3);
	}
	.bar.b1 {
		height: 4px;
	}
	.bar.b2 {
		height: 7px;
	}
	.bar.b3 {
		height: 10px;
	}
	.bar.on {
		background: var(--saffron, #e0a106);
	}

	/* time = dots */
	.dots {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accents-3);
	}
	.dot.on {
		background: var(--sage, #5f9a6f);
	}

	/* Nesting guide rail + indent. */
	.children {
		margin-left: 16px;
		padding-left: 8px;
		border-left: 1px solid var(--border);
	}
</style>
