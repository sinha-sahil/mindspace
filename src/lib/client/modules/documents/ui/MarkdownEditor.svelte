<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { EditorView } from '@codemirror/view';
	import { EditorState } from '@codemirror/state';
	import Icon, { type IconName } from '$lib/client/components/Icon.svelte';
	import { renderMarkdown, enhanceRendered, countWords, readingTimeMinutes } from '../markdown';
	import {
		buildExtensions,
		formatStateAt,
		toggleBold,
		toggleItalic,
		toggleStrike,
		toggleInlineCode,
		toggleQuote,
		toggleList,
		setHeading,
		insertLink,
		insertImage,
		insertTable,
		insertCodeBlock,
		insertMermaid,
		insertHr,
		undo,
		redo,
		openSearchPanel,
		type FormatState
	} from '../editor';

	type Props = {
		content: string;
		/** Fired on every keystroke with the full source (debounced upstream). */
		onChange: (source: string) => void;
		/** Cmd/Ctrl+S — flush the pending save. */
		onSave?: () => void;
	};
	let { content, onChange, onSave }: Props = $props();

	const LAYOUT_KEY = 'ms-doc-editor-layout';

	let host: HTMLDivElement | null = null;
	let view: EditorView | null = null;
	let previewEl: HTMLDivElement | null = $state(null);
	let scrollerEl: HTMLElement | null = null;

	let layout = $state<'write' | 'split'>('write');
	let fmt = $state<FormatState>({
		bold: false,
		italic: false,
		strike: false,
		code: false,
		quote: false,
		bullet: false,
		ordered: false,
		task: false,
		heading: 0,
		canUndo: false,
		canRedo: false
	});
	let line = $state(1);
	let col = $state(1);
	let words = $state(0);
	let chars = $state(0);
	let selWords = $state(0);
	let blockMenuOpen = $state(false);
	let insertMenuOpen = $state(false);
	// Menus render position:fixed (the toolbar is a scroll container, which
	// would clip absolutely-positioned children) — anchored at open time.
	let menuPos = $state({ x: 0, y: 0 });

	function openMenuAt(e: MouseEvent, which: 'block' | 'insert') {
		const btn = e.currentTarget;
		if (btn instanceof HTMLElement) {
			const r = btn.getBoundingClientRect();
			menuPos = { x: r.left, y: r.bottom + 6 };
		}
		blockMenuOpen = which === 'block' ? !blockMenuOpen : false;
		insertMenuOpen = which === 'insert' ? !insertMenuOpen : false;
	}

	// Preview source trails the doc by a beat so marked doesn't run per keystroke.
	let previewSrc = $state('');
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	let statsTimer: ReturnType<typeof setTimeout> | null = null;
	const previewHtml = $derived(layout === 'split' ? renderMarkdown(previewSrc) : '');

	function clearTimer(t: ReturnType<typeof setTimeout> | null) {
		if (t !== null) {
			clearTimeout(t);
		}
	}

	const isMac =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent ?? '');
	const mod = isMac ? '⌘' : 'Ctrl+';
	const alt = isMac ? '⌥' : 'Alt+';
	const shift = isMac ? '⇧' : 'Shift+';

	function refreshStats(source: string) {
		clearTimer(statsTimer);
		statsTimer = setTimeout(() => {
			words = countWords(source);
			chars = source.length;
		}, 180);
	}

	function handleViewUpdate(v: EditorView) {
		fmt = formatStateAt(v.state);
		const head = v.state.selection.main.head;
		const l = v.state.doc.lineAt(head);
		line = l.number;
		col = head - l.from + 1;
		const sel = v.state.selection.main;
		selWords = sel.empty ? 0 : countWords(v.state.sliceDoc(sel.from, sel.to));
	}

	function handleChange(source: string) {
		onChange(source);
		refreshStats(source);
		clearTimer(previewTimer);
		previewTimer = setTimeout(() => {
			previewSrc = source;
		}, 250);
	}

	onMount(() => {
		layout = localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'write';
		previewSrc = content;
		words = countWords(content);
		chars = content.length;

		view = new EditorView({
			parent: host!,
			state: EditorState.create({
				doc: content,
				extensions: buildExtensions(
					{
						onChange: handleChange,
						onViewUpdate: handleViewUpdate,
						onSave: () => onSave?.()
					},
					'Start writing… Markdown, ⌘B bold, ⌘K links — it all works.'
				)
			})
		});
		scrollerEl = view.scrollDOM;
		scrollerEl.addEventListener('scroll', onEditorScroll, { passive: true });
		handleViewUpdate(view);
		view.focus();

		return () => {
			clearTimer(previewTimer);
			clearTimer(statsTimer);
			scrollerEl?.removeEventListener('scroll', onEditorScroll);
			view?.destroy();
			view = null;
		};
	});

	// External content changes (e.g. an MCP refresh while this doc is open)
	// replace the buffer — but only when they differ from what's typed here,
	// so the echo of our own onChange never resets the cursor. An attachment
	// (re-run whenever `content` changes) instead of $effect — the lint config
	// bans $effect in favor of explicit reactive patterns.
	const syncExternalContent: Attachment<HTMLDivElement> = () => {
		const next = content;
		if (view && next !== view.state.doc.toString()) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: next }
			});
		}
	};

	function setLayout(next: 'write' | 'split') {
		// The width change makes CodeMirror re-measure; pin the scroll position
		// through it and refocus without letting focus() scroll on stale
		// geometry (that race sent the editor to the document's end).
		const scrollTop = scrollerEl?.scrollTop ?? 0;
		layout = next;
		localStorage.setItem(LAYOUT_KEY, next);
		if (next === 'split' && view) {
			previewSrc = view.state.doc.toString();
		}
		requestAnimationFrame(() => {
			if (scrollerEl) {
				scrollerEl.scrollTop = scrollTop;
			}
			view?.contentDOM.focus({ preventScroll: true });
			if (next === 'split' && scrollerEl && previewEl) {
				syncFrom(scrollerEl, previewEl);
			}
		});
	}

	/* ---- synced scrolling (percentage-based, active-pane guarded) ---- */
	let activePane: 'editor' | 'preview' = 'editor';
	let syncRaf = 0;

	function syncFrom(source: HTMLElement, target: HTMLElement) {
		cancelAnimationFrame(syncRaf);
		syncRaf = requestAnimationFrame(() => {
			const max = source.scrollHeight - source.clientHeight;
			const ratio = max > 0 ? source.scrollTop / max : 0;
			target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
		});
	}
	function onEditorScroll() {
		// Fixed-position menus would float detached from their anchor.
		if (blockMenuOpen || insertMenuOpen) {
			blockMenuOpen = false;
			insertMenuOpen = false;
		}
		if (layout === 'split' && activePane === 'editor' && scrollerEl && previewEl) {
			syncFrom(scrollerEl, previewEl);
		}
	}
	function onPreviewScroll() {
		if (activePane === 'preview' && scrollerEl && previewEl) {
			syncFrom(previewEl, scrollerEl);
		}
	}

	/* ---- toolbar actions ---- */
	function run(cmd: (v: EditorView) => boolean) {
		if (view) {
			cmd(view);
		}
	}

	function pickHeading(level: number) {
		blockMenuOpen = false;
		run(setHeading(level));
	}

	function pickInsert(action: (v: EditorView) => boolean) {
		insertMenuOpen = false;
		run(action);
	}

	const blockLabel = $derived(fmt.heading === 0 ? 'Text' : `Heading ${fmt.heading}`);

	// Close menus on any outside press.
	function onDocMouseDown(e: MouseEvent) {
		const t = e.target;
		if (!(t instanceof Element)) {
			return;
		}
		if (!t.closest('.tb-menu-wrap')) {
			blockMenuOpen = false;
			insertMenuOpen = false;
		}
	}
	onMount(() => {
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	});

	const enhancePreview: Attachment<HTMLDivElement> = (node) => {
		// Reading previewHtml makes this attachment re-run per preview render.
		void previewHtml;
		queueMicrotask(() => enhanceRendered(node));
	};

	// Track which pane the pointer is over (drives one-way scroll sync).
	// Attachments instead of onpointerenter= — these divs aren't interactive,
	// and the a11y lint rightly flags handler attributes on them.
	const markActivePane = (pane: 'editor' | 'preview'): Attachment<HTMLDivElement> => {
		return (node) => {
			const enter = () => (activePane = pane);
			node.addEventListener('pointerenter', enter);
			return () => node.removeEventListener('pointerenter', enter);
		};
	};

	type Tool = {
		icon: IconName;
		title: string;
		action: (v: EditorView) => boolean;
		isActive?: (f: FormatState) => boolean;
	};
	const inlineTools: Tool[] = [
		{ icon: 'bold', title: `Bold (${mod}B)`, action: toggleBold, isActive: (f) => f.bold },
		{ icon: 'italic', title: `Italic (${mod}I)`, action: toggleItalic, isActive: (f) => f.italic },
		{
			icon: 'strikethrough',
			title: `Strikethrough (${mod}${shift}X)`,
			action: toggleStrike,
			isActive: (f) => f.strike
		},
		{
			icon: 'code',
			title: `Inline code (${mod}E)`,
			action: toggleInlineCode,
			isActive: (f) => f.code
		}
	];
	const listTools: Tool[] = [
		{
			icon: 'list',
			title: `Bulleted list (${mod}${shift}8)`,
			action: toggleList('bullet'),
			isActive: (f) => f.bullet
		},
		{
			icon: 'list-ordered',
			title: `Numbered list (${mod}${shift}7)`,
			action: toggleList('ordered'),
			isActive: (f) => f.ordered
		},
		{
			icon: 'list-checks',
			title: `Checklist (${mod}${shift}9)`,
			action: toggleList('task'),
			isActive: (f) => f.task
		},
		{
			icon: 'text-quote',
			title: `Quote (${mod}${shift}.)`,
			action: toggleQuote,
			isActive: (f) => f.quote
		}
	];
	const insertItems: { icon: IconName; label: string; action: (v: EditorView) => boolean }[] = [
		{ icon: 'table', label: 'Table', action: insertTable },
		{ icon: 'code', label: 'Code block', action: insertCodeBlock },
		{ icon: 'layout', label: 'Mermaid diagram', action: insertMermaid },
		{ icon: 'image', label: 'Image', action: insertImage },
		{ icon: 'minus', label: 'Divider', action: insertHr }
	];
	const headingOptions = [
		{ level: 0, label: 'Normal text', kbd: `${mod}${alt}0` },
		{ level: 1, label: 'Heading 1', kbd: `${mod}${alt}1` },
		{ level: 2, label: 'Heading 2', kbd: `${mod}${alt}2` },
		{ level: 3, label: 'Heading 3', kbd: `${mod}${alt}3` }
	];

	const fmtNum = new Intl.NumberFormat();
</script>

<div class="ed-root">
	<div class="ed-toolbar" role="toolbar" aria-label="Formatting">
		<div class="tb-group">
			<button
				type="button"
				class="tb-btn"
				title="Undo ({mod}Z)"
				aria-label="Undo"
				disabled={!fmt.canUndo}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => run(undo)}
			>
				<Icon name="undo" size={15} />
			</button>
			<button
				type="button"
				class="tb-btn"
				title="Redo ({mod}{shift}Z)"
				aria-label="Redo"
				disabled={!fmt.canRedo}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => run(redo)}
			>
				<Icon name="redo" size={15} />
			</button>
		</div>

		<span class="tb-sep"></span>

		<div class="tb-group tb-menu-wrap">
			<button
				type="button"
				class="tb-block tb-block-type"
				title="Text style"
				aria-haspopup="menu"
				aria-expanded={blockMenuOpen}
				onmousedown={(e) => e.preventDefault()}
				onclick={(e) => openMenuAt(e, 'block')}
			>
				<span class="tb-block-label">{blockLabel}</span>
				<Icon name="chevron-down" size={11} />
			</button>
			{#if blockMenuOpen}
				<div
					class="tb-menu"
					style="left: {menuPos.x}px; top: {menuPos.y}px;"
					role="menu"
					aria-label="Text style"
				>
					{#each headingOptions as opt (opt.level)}
						<button
							type="button"
							class="tb-menu-item"
							class:selected={fmt.heading === opt.level}
							role="menuitem"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => pickHeading(opt.level)}
						>
							<span class="tb-menu-preview h{opt.level}">{opt.label}</span>
							<kbd>{opt.kbd}</kbd>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<span class="tb-sep"></span>

		<div class="tb-group">
			{#each inlineTools as t (t.icon)}
				<button
					type="button"
					class="tb-btn"
					class:active={t.isActive?.(fmt)}
					title={t.title}
					aria-label={t.title}
					aria-pressed={t.isActive?.(fmt)}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => run(t.action)}
				>
					<Icon name={t.icon} size={15} />
				</button>
			{/each}
			<button
				type="button"
				class="tb-btn"
				title="Link ({mod}K)"
				aria-label="Insert link"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => run(insertLink)}
			>
				<Icon name="link" size={15} />
			</button>
		</div>

		<span class="tb-sep"></span>

		<div class="tb-group">
			{#each listTools as t (t.icon)}
				<button
					type="button"
					class="tb-btn"
					class:active={t.isActive?.(fmt)}
					title={t.title}
					aria-label={t.title}
					aria-pressed={t.isActive?.(fmt)}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => run(t.action)}
				>
					<Icon name={t.icon} size={15} />
				</button>
			{/each}
		</div>

		<span class="tb-sep"></span>

		<div class="tb-group tb-menu-wrap">
			<button
				type="button"
				class="tb-block"
				title="Insert"
				aria-haspopup="menu"
				aria-expanded={insertMenuOpen}
				onmousedown={(e) => e.preventDefault()}
				onclick={(e) => openMenuAt(e, 'insert')}
			>
				<Icon name="plus" size={13} />
				<span class="tb-block-label">Insert</span>
				<Icon name="chevron-down" size={11} />
			</button>
			{#if insertMenuOpen}
				<div
					class="tb-menu"
					style="left: {menuPos.x}px; top: {menuPos.y}px;"
					role="menu"
					aria-label="Insert"
				>
					{#each insertItems as item (item.label)}
						<button
							type="button"
							class="tb-menu-item"
							role="menuitem"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => pickInsert(item.action)}
						>
							<span class="tb-menu-row">
								<Icon name={item.icon} size={14} />
								<span>{item.label}</span>
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<span class="tb-flex"></span>

		<div class="tb-group">
			<button
				type="button"
				class="tb-btn"
				title="Find & replace ({mod}F)"
				aria-label="Find and replace"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => run(openSearchPanel)}
			>
				<Icon name="search" size={15} />
			</button>
		</div>

		<span class="tb-sep"></span>

		<div class="tb-layout" role="tablist" aria-label="Editor layout">
			<button
				type="button"
				class="tb-layout-btn"
				class:active={layout === 'write'}
				role="tab"
				aria-selected={layout === 'write'}
				title="Source only"
				aria-label="Source only"
				onclick={() => setLayout('write')}
			>
				<Icon name="file-text" size={14} />
			</button>
			<button
				type="button"
				class="tb-layout-btn"
				class:active={layout === 'split'}
				role="tab"
				aria-selected={layout === 'split'}
				title="Live preview"
				aria-label="Split with live preview"
				onclick={() => setLayout('split')}
			>
				<Icon name="columns-2" size={14} />
			</button>
		</div>
	</div>

	<div class="ed-main" class:split={layout === 'split'}>
		<div
			class="ed-editor"
			bind:this={host}
			{@attach markActivePane('editor')}
			{@attach syncExternalContent}
		></div>
		{#if layout === 'split'}
			<div
				class="ed-preview"
				bind:this={previewEl}
				{@attach markActivePane('preview')}
				onscroll={onPreviewScroll}
				aria-label="Live preview"
			>
				<div class="ed-preview-body md-body" {@attach enhancePreview}>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown -->
					{@html previewHtml}
				</div>
			</div>
		{/if}
	</div>

	<footer class="ed-status">
		<span class="st-item">Ln {line}, Col {col}</span>
		<span class="st-flex"></span>
		{#if selWords > 0}
			<span class="st-item st-sel"
				>{fmtNum.format(selWords)} of {fmtNum.format(words)} words selected</span
			>
		{:else}
			<span class="st-item">{fmtNum.format(words)} {words === 1 ? 'word' : 'words'}</span>
		{/if}
		<span class="st-dot">·</span>
		<span class="st-item">{fmtNum.format(chars)} characters</span>
		<span class="st-dot">·</span>
		<span class="st-item">{readingTimeMinutes(words)} min read</span>
	</footer>
</div>

<style>
	.ed-root {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface);
	}

	/* ---------- toolbar ---------- */
	.ed-toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		overflow-x: auto;
		scrollbar-width: none;
		flex-shrink: 0;
	}
	.ed-toolbar::-webkit-scrollbar {
		display: none;
	}
	.tb-group {
		display: flex;
		align-items: center;
		gap: 1px;
		position: relative;
	}
	.tb-sep {
		width: 1px;
		height: 18px;
		background: var(--border);
		margin: 0 7px;
		flex-shrink: 0;
	}
	.tb-flex {
		flex: 1;
		min-width: 8px;
	}
	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		font: inherit;
		color: var(--fg-2);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-out);
	}
	.tb-btn:hover:not(:disabled) {
		background: var(--bg-2);
		color: var(--fg);
	}
	.tb-btn.active {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.tb-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.tb-block {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 9px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--fg-2);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
	}
	.tb-block:hover {
		background: var(--bg-2);
		color: var(--fg);
	}
	.tb-block-label {
		min-width: 0;
	}
	.tb-block.tb-block-type {
		width: 104px;
		justify-content: space-between;
	}

	.tb-menu {
		position: fixed;
		min-width: 208px;
		padding: 5px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-md);
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.tb-menu-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		width: 100%;
		padding: 6px 9px;
		font: inherit;
		color: var(--fg);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
	}
	.tb-menu-item:hover {
		background: var(--bg-2);
	}
	.tb-menu-item.selected {
		background: var(--accent-soft);
	}
	.tb-menu-item kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted-2);
		letter-spacing: 0.02em;
	}
	.tb-menu-preview {
		font-size: 13px;
	}
	.tb-menu-preview.h1 {
		font-size: 16px;
		font-weight: 700;
	}
	.tb-menu-preview.h2 {
		font-size: 14.5px;
		font-weight: 650;
	}
	.tb-menu-preview.h3 {
		font-size: 13px;
		font-weight: 600;
	}
	.tb-menu-row {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		font-size: 13px;
	}
	.tb-menu-row :global(.icon) {
		color: var(--muted);
	}

	.tb-layout {
		display: inline-flex;
		gap: 1px;
		flex-shrink: 0;
	}
	.tb-layout-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		font: inherit;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}
	.tb-layout-btn:hover {
		color: var(--fg);
		background: var(--bg-2);
	}
	.tb-layout-btn.active {
		color: var(--accent);
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	/* ---------- editor + preview ---------- */
	.ed-main {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.ed-editor {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.ed-editor :global(.cm-editor) {
		flex: 1;
		min-height: 0;
	}

	.ed-main.split .ed-editor {
		flex: 1 1 50%;
		border-right: 1px solid var(--border);
	}
	.ed-preview {
		flex: 1 1 50%;
		min-width: 0;
		overflow-y: auto;
		background: var(--bg);
	}
	.ed-preview-body {
		max-width: 720px;
		margin: 0 auto;
		padding: 32px 40px 45vh;
	}

	/* ---------- CodeMirror search panel, restyled ---------- */
	.ed-editor :global(.cm-panels) {
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		z-index: 20;
	}
	.ed-editor :global(.cm-panels.cm-panels-top) {
		border-top: none;
	}
	.ed-editor :global(.cm-panel.cm-search) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		font-family: var(--font-sans);
		font-size: 12px;
		color: var(--fg-2);
	}
	.ed-editor :global(.cm-panel.cm-search .cm-textfield) {
		font: inherit;
		font-size: 12.5px;
		color: var(--fg);
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 9px;
		outline: none;
	}
	.ed-editor :global(.cm-panel.cm-search .cm-textfield:focus) {
		border-color: var(--accent);
	}
	.ed-editor :global(.cm-panel.cm-search .cm-button) {
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--fg-2);
		background: var(--surface);
		background-image: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 10px;
		cursor: pointer;
	}
	.ed-editor :global(.cm-panel.cm-search .cm-button:hover) {
		border-color: var(--border-strong);
		color: var(--fg);
	}
	.ed-editor :global(.cm-panel.cm-search label) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11.5px;
		color: var(--muted);
		text-transform: capitalize;
	}
	.ed-editor :global(.cm-panel.cm-search input[type='checkbox']) {
		accent-color: var(--accent);
		margin: 0;
	}
	.ed-editor :global(.cm-panel.cm-search button[name='close']) {
		position: absolute;
		right: 8px;
		top: 8px;
		width: 22px;
		height: 22px;
		font-size: 15px;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
	}
	.ed-editor :global(.cm-panel.cm-search button[name='close']:hover) {
		background: var(--bg-2);
		color: var(--fg);
	}

	/* ---------- status bar ---------- */
	.ed-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 16px;
		border-top: 1px solid var(--border);
		background: var(--surface);
		font-size: 11.5px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
		user-select: none;
	}
	.st-flex {
		flex: 1;
	}
	.st-dot {
		color: var(--soft);
	}
	.st-sel {
		color: var(--accent);
		font-weight: 500;
	}

	@media (max-width: 860px) {
		.ed-main.split {
			flex-direction: column;
		}
		.ed-main.split .ed-editor {
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
		.st-item:nth-last-child(3),
		.st-dot:nth-last-child(2) {
			display: none;
		}
	}
</style>
