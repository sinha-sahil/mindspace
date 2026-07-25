<script lang="ts">
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { EditorView } from '@codemirror/view';
	import { EditorState, EditorSelection } from '@codemirror/state';
	import Icon, { type IconName } from '$lib/client/components/Icon.svelte';
	import { toasts } from '$lib/client/modules/toasts';
	import { comments } from '../comments.svelte';
	import { countWords, readingTimeMinutes, locateAnchorInText, type Anchor } from '../markdown';
	import { livePreview } from '../livemd';
	import {
		buildExtensions,
		commentHighlights,
		refreshCommentsEffect,
		setPendingComment,
		outlineFromSource,
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
		type FormatState,
		type SourceOutlineItem
	} from '../editor';

	type Props = {
		/** Document id — used for comment threads. Omit to disable commenting. */
		documentId?: string | null;
		content: string;
		/** Fired on every keystroke with the full source (debounced upstream). */
		onChange: (source: string) => void;
		/** Cmd/Ctrl+S — flush the pending save. */
		onSave?: () => void;
		/** A comment highlight was clicked — focus its thread in the panel. */
		onSelectThread?: (commentId: string) => void;
	};
	let { documentId = null, content, onChange, onSave, onSelectThread }: Props = $props();

	let host: HTMLDivElement | null = null;
	let mainEl: HTMLDivElement | null = $state(null);
	let view: EditorView | null = null;
	let scrollerEl: HTMLElement | null = null;

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

	let statsTimer: ReturnType<typeof setTimeout> | null = null;
	let outlineTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTimer(t: ReturnType<typeof setTimeout> | null) {
		if (t !== null) {
			clearTimeout(t);
		}
	}

	function openMenuAt(e: MouseEvent, which: 'block' | 'insert') {
		const btn = e.currentTarget;
		if (btn instanceof HTMLElement) {
			const r = btn.getBoundingClientRect();
			menuPos = { x: r.left, y: r.bottom + 6 };
		}
		blockMenuOpen = which === 'block' ? !blockMenuOpen : false;
		insertMenuOpen = which === 'insert' ? !insertMenuOpen : false;
	}

	const isMac =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent ?? '');
	const mod = isMac ? '⌘' : 'Ctrl+';
	const alt = isMac ? '⌥' : 'Alt+';
	const shift = isMac ? '⇧' : 'Shift+';

	/* ---------------- outline ---------------- */
	const OUTLINE_KEY = 'ms-doc-outline';
	let outline = $state<SourceOutlineItem[]>([]);
	let outlineHidden = $state(false);
	let activeOutlineFrom = $state<number>(-1);

	function setOutlineHidden(hidden: boolean) {
		outlineHidden = hidden;
		localStorage.setItem(OUTLINE_KEY, hidden ? 'hidden' : 'shown');
	}

	function refreshOutline(source: string) {
		clearTimer(outlineTimer);
		outlineTimer = setTimeout(() => {
			outline = outlineFromSource(source);
			refreshSpy();
		}, 250);
	}

	function refreshSpy() {
		if (!view || !scrollerEl || outline.length === 0) {
			return;
		}
		const rect = scrollerEl.getBoundingClientRect();
		const probe = view.posAtCoords({ x: rect.left + 24, y: rect.top + 90 }, false);
		let active = outline[0]?.from ?? -1;
		for (const item of outline) {
			if (item.from <= probe) {
				active = item.from;
			} else {
				break;
			}
		}
		activeOutlineFrom = active;
	}

	function jumpToHeading(from: number) {
		if (!view) {
			return;
		}
		const pos = Math.min(from, view.state.doc.length);
		activeOutlineFrom = from;
		view.dispatch({
			selection: EditorSelection.cursor(pos),
			effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 })
		});
		view.focus();
	}

	/* ---------------- comments (dblclick → thread) ---------------- */
	let pendingRange = $state<{ from: number; to: number; quote: string } | null>(null);
	let popupX = $state(0);
	let popupY = $state(0);
	let showForm = $state(false);
	let commentDraft = $state('');
	let saving = $state(false);

	const commentAnchors = () => {
		if (!documentId) {
			return [];
		}
		const out: ({ id: string } & Anchor)[] = [];
		for (const c of comments.items) {
			if (c.documentId !== documentId) {
				continue;
			}
			if (c.anchorQuote === null || c.anchorStart === null || c.anchorEnd === null) {
				continue;
			}
			out.push({
				id: c.id,
				quote: c.anchorQuote,
				prefix: c.anchorPrefix,
				suffix: c.anchorSuffix,
				start: c.anchorStart,
				end: c.anchorEnd
			});
		}
		return out;
	};

	function dismissPopup() {
		pendingRange = null;
		showForm = false;
		commentDraft = '';
		view?.dispatch({ effects: setPendingComment.of(null) });
		scheduleCommentBtn();
	}

	// Google-Docs model: any selection surfaces a quiet comment button in the
	// right margin (the page never shifts while selecting); ⌘⌥M does the same
	// from the keyboard. The button tracks the selection head through scrolls.
	let commentBtn = $state<{ x: number; y: number } | null>(null);
	let commentAnchorPos: number | null = null;
	let commentBtnTimer: ReturnType<typeof setTimeout> | null = null;
	let pointerHeld = false;

	function hideCommentBtn() {
		clearTimer(commentBtnTimer);
		commentBtnTimer = null;
		commentBtn = null;
		commentAnchorPos = null;
	}

	function positionCommentBtn(): boolean {
		if (!view || !mainEl || !documentId) {
			return false;
		}
		const sel = view.state.selection.main;
		if (sel.empty) {
			return false;
		}
		const coords = view.coordsAtPos(sel.head);
		if (!coords) {
			return false;
		}
		const hostRect = mainEl.getBoundingClientRect();
		const edRect = view.dom.getBoundingClientRect();
		commentAnchorPos = sel.head;
		commentBtn = {
			x: edRect.right - hostRect.left - 46,
			y: Math.max(6, coords.top - hostRect.top - 4)
		};
		return true;
	}

	function scheduleCommentBtn() {
		clearTimer(commentBtnTimer);
		commentBtnTimer = setTimeout(() => {
			if (!pointerHeld && !pendingRange) {
				if (!positionCommentBtn()) {
					commentBtn = null;
				}
			}
		}, 180);
	}

	function startComment() {
		if (!documentId || !view || !mainEl) {
			return;
		}
		const sel = view.state.selection.main;
		if (sel.empty) {
			return;
		}
		if (!commentBtn) {
			positionCommentBtn();
		}
		const anchor = commentBtn ?? { x: mainEl.clientWidth - 60, y: 40 };
		const POPUP_HALF = 160;
		const PAD = 12;
		popupX = Math.max(
			POPUP_HALF + PAD,
			Math.min(mainEl.clientWidth - POPUP_HALF - PAD, anchor.x - 140)
		);
		popupY = anchor.y + 24;
		pendingRange = {
			from: sel.from,
			to: sel.to,
			quote: view.state.doc.sliceString(sel.from, sel.to)
		};
		commentDraft = '';
		// Keep the target text visibly marked while focus moves to the composer.
		view.dispatch({ effects: setPendingComment.of({ from: sel.from, to: sel.to }) });
		hideCommentBtn();
		openForm();
	}

	function openForm() {
		showForm = true;
		queueMicrotask(() => {
			const t = document.querySelector<HTMLTextAreaElement>('.cmt-popup textarea');
			t?.focus();
		});
	}

	async function submitComment() {
		if (!documentId || !view || !pendingRange || !commentDraft.trim() || saving) {
			return;
		}
		const doc = view.state.doc;
		const { from, to } = pendingRange;
		const CONTEXT = 32;
		saving = true;
		const result = await comments.startThread(documentId, {
			body: commentDraft.trim(),
			quote: doc.sliceString(from, to),
			prefix: doc.sliceString(Math.max(0, from - CONTEXT), from),
			suffix: doc.sliceString(to, Math.min(doc.length, to + CONTEXT)),
			start: from,
			end: to
		});
		saving = false;
		if (result) {
			toasts.success('Comment added');
			dismissPopup();
			view.dispatch({ effects: refreshCommentsEffect.of(null) });
		}
	}

	/** Scroll the editor to a thread's anchored text and select it. */
	export function scrollToThread(commentId: string) {
		if (!view) {
			return;
		}
		const anchor = commentAnchors().find((a) => a.id === commentId);
		if (!anchor) {
			return;
		}
		const hit = locateAnchorInText(view.state.doc.toString(), anchor);
		if (!hit) {
			return;
		}
		view.dispatch({
			selection: EditorSelection.range(hit.start, hit.end),
			effects: EditorView.scrollIntoView(hit.start, { y: 'center' })
		});
		view.focus();
	}

	/* ---------------- stats + view updates ---------------- */
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
		if (sel.empty) {
			hideCommentBtn();
		} else if (!pendingRange) {
			scheduleCommentBtn();
		}
	}

	function handleChange(source: string) {
		onChange(source);
		refreshStats(source);
		refreshOutline(source);
		dismissPopup();
	}

	onMount(() => {
		outlineHidden = localStorage.getItem(OUTLINE_KEY) === 'hidden';
		words = countWords(content);
		chars = content.length;
		outline = outlineFromSource(content);

		view = new EditorView({
			parent: host!,
			state: EditorState.create({
				doc: content,
				extensions: [
					...buildExtensions(
						{
							onChange: handleChange,
							onViewUpdate: handleViewUpdate,
							onSave: () => onSave?.(),
							onComment: () => startComment()
						},
						'Start writing… Markdown renders as you type — ⌘B bold, ⌘K links.'
					),
					livePreview(),
					commentHighlights({
						getAnchors: commentAnchors,
						onOrphans: (ids) => {
							if (documentId) {
								comments.setOrphans(ids);
							}
						},
						onSelect: (id) => onSelectThread?.(id)
					})
				]
			})
		});
		scrollerEl = view.scrollDOM;
		scrollerEl.addEventListener('scroll', onEditorScroll, { passive: true });
		view.contentDOM.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('pointerup', onPointerUp);
		handleViewUpdate(view);
		refreshSpy();
		view.focus();

		return () => {
			clearTimer(statsTimer);
			clearTimer(outlineTimer);
			view?.contentDOM.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('pointerup', onPointerUp);
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

	// Rebuild comment highlights when the thread set changes (loads async).
	const syncCommentDecos: Attachment<HTMLDivElement> = () => {
		void comments.items.length;
		if (view) {
			view.dispatch({ effects: refreshCommentsEffect.of(null) });
		}
	};

	function onPointerDown() {
		pointerHeld = true;
		hideCommentBtn();
	}
	function onPointerUp() {
		if (!pointerHeld) {
			return;
		}
		pointerHeld = false;
		scheduleCommentBtn();
	}

	function onEditorScroll() {
		// Fixed-position menus would float detached from their anchor.
		if (blockMenuOpen || insertMenuOpen) {
			blockMenuOpen = false;
			insertMenuOpen = false;
		}
		if (pendingRange) {
			dismissPopup();
		}
		// The margin button glues to its text through scrolls.
		if (commentBtn && commentAnchorPos !== null && view && mainEl) {
			const coords = view.coordsAtPos(Math.min(commentAnchorPos, view.state.doc.length));
			if (coords) {
				const hostRect = mainEl.getBoundingClientRect();
				commentBtn = { x: commentBtn.x, y: Math.max(6, coords.top - hostRect.top - 4) };
			} else {
				hideCommentBtn();
			}
		}
		refreshSpy();
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

	// Close menus/popups on any outside press.
	function onDocMouseDown(e: MouseEvent) {
		const t = e.target;
		if (!(t instanceof Element)) {
			return;
		}
		if (!t.closest('.tb-menu-wrap')) {
			blockMenuOpen = false;
			insertMenuOpen = false;
		}
		if (!t.closest('.cmt-popup') && !t.closest('.cmt-margin') && !t.closest('.cm-editor')) {
			dismissPopup();
		}
	}
	onMount(() => {
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	});

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
	</div>

	<div class="ed-main" bind:this={mainEl}>
		{#if outline.length >= 2}
			<nav class="outline" class:collapsed={outlineHidden} aria-label="Document outline">
				{#if outlineHidden}
					<button
						type="button"
						class="outline-reveal"
						title="Show outline"
						aria-label="Show document outline"
						onclick={() => setOutlineHidden(false)}
					>
						<Icon name="list" size={14} />
					</button>
				{:else}
					<div class="outline-head">
						<span class="outline-title">Outline</span>
						<button
							type="button"
							class="outline-hide"
							title="Hide outline"
							aria-label="Hide document outline"
							onclick={() => setOutlineHidden(true)}
						>
							<Icon name="chevron-left" size={12} />
						</button>
					</div>
					<ul class="outline-list">
						{#each outline as item (item.from + item.text)}
							<li>
								<button
									type="button"
									class="outline-item lv{item.level}"
									class:active={activeOutlineFrom === item.from}
									onclick={() => jumpToHeading(item.from)}
								>
									{item.text}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</nav>
		{/if}

		<div
			class="ed-editor"
			bind:this={host}
			{@attach syncExternalContent}
			{@attach syncCommentDecos}
		></div>

		{#if commentBtn && !pendingRange}
			<button
				type="button"
				class="cmt-margin"
				style="left: {commentBtn.x}px; top: {commentBtn.y}px;"
				onmousedown={(e) => {
					e.preventDefault();
					e.stopPropagation();
				}}
				onclick={startComment}
				title="Add comment ({mod}{alt}M)"
				aria-label="Add comment on selection"
			>
				<Icon name="message-square" size={15} />
			</button>
		{/if}

		{#if pendingRange && showForm}
			<div
				class="cmt-popup"
				style="left: {popupX}px; top: {popupY + 12}px;"
				role="dialog"
				aria-label="Add comment"
				tabindex="-1"
				onmousedown={(e) => e.stopPropagation()}
			>
				<div class="cmt-quote">"{pendingRange.quote}"</div>
				<textarea
					class="cmt-input"
					bind:value={commentDraft}
					placeholder="Write a comment…"
					rows="3"
					onkeydown={(e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
							e.preventDefault();
							submitComment();
						} else if (e.key === 'Escape') {
							e.preventDefault();
							dismissPopup();
						}
					}}
				></textarea>
				<div class="cmt-actions">
					<button type="button" class="btn ghost" onclick={dismissPopup}>Cancel</button>
					<button
						type="button"
						class="btn primary"
						disabled={!commentDraft.trim() || saving}
						onclick={submitComment}
					>
						{saving ? 'Saving…' : 'Comment'}
					</button>
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
		min-width: 0;
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
		opacity: var(--disabled-opacity);
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
		color: var(--muted);
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

	/* ---------- main: outline + editor ---------- */
	.ed-main {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
	}

	.outline {
		flex: 0 0 216px;
		min-height: 0;
		padding: 22px 8px 20px 18px;
		overflow-y: auto;
		background: var(--surface);
	}
	.outline.collapsed {
		flex: 0 0 44px;
		padding: 16px 6px;
		display: flex;
		justify-content: center;
		align-items: flex-start;
	}
	.outline-reveal {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}
	.outline-reveal:hover {
		color: var(--fg);
		background: var(--bg-2);
	}
	.outline-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 8px 8px 10px;
	}
	.outline-title {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.outline-hide {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}
	.outline:hover .outline-hide,
	.outline-hide:focus-visible {
		opacity: 1;
	}
	.outline-hide:hover {
		color: var(--fg);
		background: var(--bg-2);
	}
	.outline-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.outline-item {
		display: block;
		width: 100%;
		padding: 4px 8px 4px 10px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 450;
		line-height: 1.45;
		color: var(--fg-2);
		background: transparent;
		border: none;
		border-left: 2px solid transparent;
		border-radius: 0 6px 6px 0;
		cursor: pointer;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition:
			color var(--duration-fast) var(--ease-out),
			background var(--duration-fast) var(--ease-out);
	}
	.outline-item:hover {
		color: var(--fg);
		background: var(--bg-2);
	}
	.outline-item.active {
		color: var(--accent);
		border-left-color: var(--accent);
		font-weight: 560;
	}
	.outline-item.lv2 {
		padding-left: 22px;
	}
	.outline-item.lv3 {
		padding-left: 34px;
		font-size: 12px;
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

	/* ---------- live-preview decorations ---------- */
	.ed-editor :global(.livemd-bullet) {
		display: inline-block;
		color: var(--muted);
		font-weight: 700;
	}
	.ed-editor :global(.livemd-task) {
		display: inline-flex;
		align-items: center;
	}
	.ed-editor :global(.livemd-task input) {
		appearance: none;
		-webkit-appearance: none;
		width: 15px;
		height: 15px;
		margin: 0 2px 0 0;
		vertical-align: -2.5px;
		border: 1.5px solid var(--border-strong);
		border-radius: 4.5px;
		background: var(--surface);
		cursor: pointer;
		position: relative;
		transition:
			background var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}
	.ed-editor :global(.livemd-task input:hover) {
		border-color: var(--accent);
	}
	.ed-editor :global(.livemd-task input:checked) {
		background: var(--accent);
		border-color: var(--accent);
	}
	.ed-editor :global(.livemd-task input:checked::after) {
		content: '';
		position: absolute;
		left: 4px;
		top: 1px;
		width: 4px;
		height: 8px;
		border: solid var(--bg);
		border-width: 0 1.8px 1.8px 0;
		transform: rotate(45deg);
	}
	.ed-editor :global(.livemd-task-done) {
		color: var(--muted);
	}
	.ed-editor :global(.livemd-hr) {
		display: inline-block;
		width: 100%;
		height: 0.5em;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}
	.ed-editor :global(.livemd-quote) {
		border-left: 2px solid var(--soft);
		padding-left: 14px !important;
	}
	/* Code tints are TRANSLUCENT on purpose: line/mark backgrounds paint above
	   CodeMirror's selection layer, so an opaque fill would make selections
	   invisible across code. */
	.ed-editor :global(.livemd-codeline) {
		background: color-mix(in srgb, var(--fg) 4%, transparent);
	}
	.ed-editor :global(.livemd-fence) {
		color: var(--muted);
	}
	.ed-editor :global(.livemd-code) {
		background: color-mix(in srgb, var(--fg) 6%, transparent);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 1px 4px;
	}
	.ed-editor :global(.livemd-link) {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
	}
	.ed-editor :global(.livemd-callout) {
		font-size: 0.82em;
		font-weight: 650;
		letter-spacing: 0.05em;
		color: var(--callout-hue, var(--accent));
		background: color-mix(in srgb, var(--callout-hue, var(--accent)) 12%, transparent);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.ed-editor :global(.livemd-callout-tip) {
		--callout-hue: var(--sage);
	}
	.ed-editor :global(.livemd-callout-important) {
		--callout-hue: var(--code-kw);
	}
	.ed-editor :global(.livemd-callout-warning) {
		--callout-hue: var(--saffron);
	}
	.ed-editor :global(.livemd-callout-caution) {
		--callout-hue: var(--rose);
	}
	.ed-editor :global(.livemd-tablewrap) {
		padding: 4px 0 6px;
		overflow-x: auto;
	}
	.ed-editor :global(.livemd-table) {
		border-collapse: collapse;
		width: 100%;
		font-family: var(--font-sans);
		font-size: 13px;
		line-height: 1.55;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.ed-editor :global(.livemd-table th),
	.ed-editor :global(.livemd-table td) {
		padding: 7px 13px;
		text-align: left;
		vertical-align: top;
		border-right: 1px solid var(--border);
	}
	.ed-editor :global(.livemd-table th:last-child),
	.ed-editor :global(.livemd-table td:last-child) {
		border-right: none;
	}
	.ed-editor :global(.livemd-table thead th) {
		font-size: 11.5px;
		font-weight: 620;
		letter-spacing: 0.02em;
		color: var(--fg-2);
		background: var(--surface-2);
		border-bottom: 1px solid var(--border-strong);
		white-space: nowrap;
	}
	.ed-editor :global(.livemd-table tbody td) {
		border-top: 1px solid var(--border);
	}
	.ed-editor :global(.livemd-table tbody tr:first-child td) {
		border-top: none;
	}
	.ed-editor :global(.livemd-table tbody tr) {
		cursor: pointer;
	}
	.ed-editor :global(.livemd-table tbody tr:hover td) {
		background: color-mix(in srgb, var(--bg-2) 55%, transparent);
	}
	.ed-editor :global(.livemd-table code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 1px 4px;
	}
	.ed-editor :global(.livemd-table a) {
		color: var(--accent);
	}

	.ed-editor :global(.livemd-mermaid) {
		padding: 6px 0;
		text-align: center;
		cursor: default;
	}
	.ed-editor :global(.livemd-mermaid pre.mermaid-diagram) {
		position: relative;
		margin: 0;
		padding: 0;
		background: transparent;
		border: none;
		font-family: var(--font-mono);
		white-space: pre-wrap;
		color: var(--muted);
	}
	.ed-editor :global(.livemd-mermaid svg) {
		max-width: 100%;
		height: auto;
	}
	.ed-editor :global(.livemd-mermaid .mermaid-fullscreen-btn) {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		color: var(--muted);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}
	.ed-editor :global(.livemd-mermaid:hover .mermaid-fullscreen-btn) {
		opacity: 1;
	}
	.ed-editor :global(.livemd-mermaid .mermaid-fullscreen-btn svg) {
		width: 15px;
		height: 15px;
	}

	.ed-editor :global(.cm-comment-pending) {
		background: color-mix(in srgb, var(--saffron) 20%, transparent);
		box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--saffron) 60%, transparent);
		border-radius: 2px;
	}

	/* ---------- comment anchors ---------- */
	.ed-editor :global(.cm-comment-anchor) {
		background: color-mix(in srgb, var(--saffron) 14%, transparent);
		box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--saffron) 55%, transparent);
		border-radius: 2px;
		cursor: pointer;
	}
	.ed-editor :global(.cm-comment-anchor:hover) {
		background: color-mix(in srgb, var(--saffron) 26%, transparent);
	}

	/* ---------- comment trigger + popup ---------- */
	.cmt-margin {
		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		color: var(--fg-2);
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
		z-index: 5;
		transition:
			color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.cmt-margin:hover {
		color: var(--accent);
		border-color: var(--accent);
		transform: scale(1.06);
	}
	.cmt-popup {
		position: absolute;
		transform: translate(-50%, 0);
		width: 320px;
		padding: 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-md);
		z-index: 6;
	}
	.cmt-quote {
		font-size: 12px;
		color: var(--fg-2);
		background: var(--bg-2);
		padding: 6px 8px;
		border-radius: 5px;
		margin-bottom: 8px;
		max-height: 60px;
		overflow-y: auto;
		font-style: italic;
	}
	.cmt-input {
		width: 100%;
		padding: 8px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		outline: none;
		resize: vertical;
		min-height: 60px;
	}
	.cmt-input:focus {
		border-color: var(--accent);
	}
	.cmt-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: 8px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 28px;
		padding: 0 12px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		border-radius: 6px;
		border: 1px solid;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: var(--disabled-opacity);
		cursor: not-allowed;
	}
	.btn.ghost {
		color: var(--fg-2);
		background: transparent;
		border-color: var(--border);
	}
	.btn.primary {
		color: var(--bg);
		background: var(--fg);
		border-color: var(--fg);
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

	@media (max-width: 1080px) {
		.outline {
			display: none;
		}
	}
	@media (max-width: 860px) {
		.st-item:nth-last-child(3),
		.st-dot:nth-last-child(2) {
			display: none;
		}
	}
</style>
