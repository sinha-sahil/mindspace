<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { onMount } from 'svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { toasts } from '$lib/client/modules/toasts';
	import { comments } from '../comments.svelte';
	import {
		renderMarkdown,
		enhanceRendered,
		outlineFrom,
		toggleTaskInSource,
		anchorFromSelection,
		applyHighlights,
		type Anchor,
		type EnhanceOptions,
		type OutlineItem
	} from '../markdown';

	type Props = {
		documentId: string;
		content: string;
		/** Fired when the user clicks an existing comment highlight. */
		onSelectThread?: (commentId: string) => void;
		/** Present when the doc is editable — enables live task checkboxes. */
		onChange?: (source: string) => void;
		/** "Start writing" CTA for empty documents. */
		onRequestEdit?: () => void;
	};
	let { documentId, content, onSelectThread, onChange, onRequestEdit }: Props = $props();

	const html = $derived(renderMarkdown(content));
	const isEmpty = $derived(content.trim() === '');

	// Cheap content hash (djb2) — content.length alone misses same-length
	// edits like a task toggling between "[ ]" and "[x]".
	function hash(s: string): number {
		let h = 5381;
		for (let i = 0; i < s.length; i++) {
			h = ((h << 5) + h + s.charCodeAt(i)) | 0;
		}
		return h;
	}

	// A version key that changes when content OR comment set changes — used
	// by {#key} below to throw away the DOM (and any previously-applied
	// <mark> wrappers) so highlights re-apply against a clean slate.
	const version = $derived(`${hash(content)}::${comments.items.map((c) => c.id).join(',')}`);

	/* ---------------- outline ---------------- */
	const OUTLINE_KEY = 'ms-doc-outline';
	let outline = $state<OutlineItem[]>([]);
	let outlineHidden = $state(false);
	let activeHeadingId = $state<string | null>(null);
	let hostEl: HTMLDivElement | null = $state(null);
	let headingEls: HTMLElement[] = [];
	let spyRaf = 0;

	onMount(() => {
		outlineHidden = localStorage.getItem(OUTLINE_KEY) === 'hidden';
	});

	function setOutlineHidden(hidden: boolean) {
		outlineHidden = hidden;
		localStorage.setItem(OUTLINE_KEY, hidden ? 'hidden' : 'shown');
	}

	function refreshSpy() {
		cancelAnimationFrame(spyRaf);
		spyRaf = requestAnimationFrame(() => {
			if (!hostEl || headingEls.length === 0) {
				return;
			}
			const hostTop = hostEl.getBoundingClientRect().top;
			let current: string | null = headingEls[0]?.id ?? null;
			for (const el of headingEls) {
				if (el.getBoundingClientRect().top - hostTop <= 96) {
					current = el.id;
				} else {
					break;
				}
			}
			activeHeadingId = current;
		});
	}

	function jumpToHeading(id: string) {
		const el = headingEls.find((h) => h.id === id);
		if (el) {
			activeHeadingId = id;
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	/* ---------------- image lightbox ---------------- */
	let lightbox = $state<{ src: string; alt: string } | null>(null);

	/* ---------------- task toggles ---------------- */
	function handleTaskToggle(index: number, checked: boolean) {
		if (!onChange) {
			return;
		}
		const next = toggleTaskInSource(content, index, checked);
		if (next !== null) {
			onChange(next);
		}
	}

	/* ---------------- comment popup (selection → thread) ---------------- */
	let containerEl: HTMLDivElement | null = $state(null);
	let pendingAnchor = $state<Anchor | null>(null);
	let popupX = $state(0);
	let popupY = $state(0);
	let showForm = $state(false);
	let commentDraft = $state('');
	let saving = $state(false);

	function dismissPopup() {
		pendingAnchor = null;
		showForm = false;
		commentDraft = '';
	}

	function onMouseUp(e: MouseEvent) {
		// Defer one tick so window.getSelection reflects the just-released drag.
		queueMicrotask(() => {
			if (!containerEl) {
				return;
			}
			// If the click landed inside the popup itself, don't reset.
			const target = e.target;
			if (target instanceof Element && target.closest('.cmt-popup')) {
				return;
			}
			const anchor = anchorFromSelection(containerEl);
			if (!anchor) {
				dismissPopup();
				return;
			}
			pendingAnchor = anchor;
			showForm = false;
			commentDraft = '';

			// Position the trigger above the selection's bounding rect, relative
			// to the host. Clamp X so the popup (320px wide, centered via
			// translate(-50%)) stays inside the host even when the selection is
			// near the left or right edge.
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || !hostEl) {
				return;
			}
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			const cRect = hostEl.getBoundingClientRect();
			const rawX = rect.left - cRect.left + rect.width / 2;
			const POPUP_HALF_WIDTH = 160; // matches .cmt-popup width 320 / 2
			const EDGE_PAD = 12;
			const hostWidth = hostEl.clientWidth;
			popupX = Math.max(
				POPUP_HALF_WIDTH + EDGE_PAD,
				Math.min(hostWidth - POPUP_HALF_WIDTH - EDGE_PAD, rawX)
			);
			// Y: keep the trigger above the selection (popup opens below it),
			// in host-content coordinates (account for the host's scroll).
			popupY = rect.top - cRect.top + hostEl.scrollTop - 8;
		});
	}

	function onDocMouseDown(e: MouseEvent) {
		// Click outside the container, the trigger, and the popup closes it.
		if (!containerEl) {
			return;
		}
		const target = e.target;
		if (!(target instanceof Element)) {
			return;
		}
		if (
			containerEl.contains(target) ||
			target.closest('.cmt-popup') ||
			target.closest('.cmt-trigger')
		) {
			return;
		}
		dismissPopup();
	}

	function openForm() {
		showForm = true;
		// Focus the textarea once it's mounted.
		queueMicrotask(() => {
			const t = document.querySelector<HTMLTextAreaElement>('.cmt-popup textarea');
			t?.focus();
		});
	}

	async function submit() {
		if (!pendingAnchor || !commentDraft.trim() || saving) {
			return;
		}
		saving = true;
		const result = await comments.startThread(documentId, {
			body: commentDraft.trim(),
			quote: pendingAnchor.quote,
			prefix: pendingAnchor.prefix,
			suffix: pendingAnchor.suffix,
			start: pendingAnchor.start,
			end: pendingAnchor.end
		});
		saving = false;
		if (result) {
			toasts.success('Comment added');
			dismissPopup();
			window.getSelection()?.removeAllRanges();
		}
	}

	// Attach the mouseup handler via an attachment instead of an `onmouseup=`
	// attribute — the host div isn't semantically interactive, and the Svelte
	// a11y lint correctly flags handler attributes on plain <div>s.
	const captureSelection: Attachment<HTMLDivElement> = (node) => {
		node.addEventListener('mouseup', onMouseUp);
		return () => node.removeEventListener('mouseup', onMouseUp);
	};

	/**
	 * Everything that runs against a freshly rendered container, in order:
	 * comment highlights first (they operate on pristine text offsets), then
	 * click delegation for marks, then the enhancement pass (anchors, copy
	 * buttons, tasks, tables, images, hljs, mermaid), then outline extraction.
	 */
	const setupRendered: Attachment<HTMLDivElement> = (node) => {
		// 1. Saved-comment highlights (thread roots only; replies carry none).
		const anchors: Array<{ id: string } & Anchor> = [];
		for (const c of comments.items) {
			if (c.documentId !== documentId) {
				continue;
			}
			if (c.anchorQuote === null || c.anchorStart === null || c.anchorEnd === null) {
				continue;
			}
			anchors.push({
				id: c.id,
				quote: c.anchorQuote,
				prefix: c.anchorPrefix,
				suffix: c.anchorSuffix,
				start: c.anchorStart,
				end: c.anchorEnd
			});
		}
		const orphans = applyHighlights(node, anchors);
		comments.setOrphans(orphans);

		// 2. Click delegation: a click on a saved highlight opens its thread.
		function onClick(e: MouseEvent) {
			const target = e.target;
			if (!(target instanceof Element)) {
				return;
			}
			const mark = target.closest<HTMLElement>('mark.comment-mark');
			if (!mark) {
				return;
			}
			const id = mark.dataset.commentId;
			if (id) {
				onSelectThread?.(id);
			}
		}
		node.addEventListener('click', onClick);

		// 3. Interactive upgrades.
		const enhanceOpts: EnhanceOptions = {
			onImageZoom: (src, alt) => (lightbox = { src, alt })
		};
		if (onChange) {
			enhanceOpts.onTaskToggle = handleTaskToggle;
		}
		enhanceRendered(node, enhanceOpts);

		// 4. Outline.
		outline = outlineFrom(node);
		headingEls = Array.from(node.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')).filter(
			(h) => !h.closest('.footnotes')
		);
		refreshSpy();

		return () => {
			node.removeEventListener('click', onClick);
			cancelAnimationFrame(spyRaf);
		};
	};

	onMount(() => {
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && lightbox) {
			e.preventDefault();
			lightbox = null;
		}
	}}
/>

<div class="view-root">
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
					{#each outline as item (item.id + item.text)}
						<li>
							<button
								type="button"
								class="outline-item lv{item.level}"
								class:active={activeHeadingId === item.id}
								onclick={() => jumpToHeading(item.id)}
							>
								{item.text}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</nav>
	{/if}

	<div class="md-host" bind:this={hostEl} {@attach captureSelection} onscroll={refreshSpy}>
		{#if isEmpty}
			<div class="md-empty">
				<Icon name="file-text" size={26} class="md-empty-icon" />
				<p>This document is empty.</p>
				{#if onRequestEdit}
					<button type="button" class="md-empty-cta" onclick={onRequestEdit}>
						<Icon name="pencil" size={12} />
						<span>Start writing</span>
					</button>
				{/if}
			</div>
		{:else}
			{#key version}
				<div
					bind:this={containerEl}
					class="md-render md-body print-root"
					role="article"
					{@attach setupRendered}
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMarkdown -->
					{@html html}
				</div>
			{/key}
		{/if}

		{#if pendingAnchor && !showForm}
			<button
				type="button"
				class="cmt-trigger"
				style="left: {popupX}px; top: {popupY}px;"
				onmousedown={(e) => {
					// Prevent text deselection AND prevent the doc handler from
					// dismissing the trigger before our onclick runs.
					e.preventDefault();
					e.stopPropagation();
				}}
				onclick={openForm}
				title="Add comment on selection"
			>
				<Icon name="plus" size={11} />
				<span>Comment</span>
			</button>
		{/if}

		{#if pendingAnchor && showForm}
			<div
				class="cmt-popup"
				style="left: {popupX}px; top: {popupY + 12}px;"
				role="dialog"
				aria-label="Add comment"
				tabindex="-1"
				onmousedown={(e) => e.stopPropagation()}
			>
				<div class="cmt-quote">"{pendingAnchor.quote}"</div>
				<textarea
					class="cmt-input"
					bind:value={commentDraft}
					placeholder="Write a comment…"
					rows="3"
					onkeydown={(e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
							e.preventDefault();
							submit();
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
						onclick={submit}
					>
						{saving ? 'Saving…' : 'Comment'}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

{#if lightbox}
	<div
		class="lightbox"
		role="dialog"
		aria-modal="true"
		aria-label={lightbox.alt || 'Image preview'}
	>
		<button
			type="button"
			class="lightbox-backdrop"
			aria-label="Close image preview"
			onclick={() => (lightbox = null)}
		></button>
		<figure class="lightbox-figure">
			<img src={lightbox.src} alt={lightbox.alt} />
			{#if lightbox.alt}
				<figcaption>{lightbox.alt}</figcaption>
			{/if}
		</figure>
		<button
			type="button"
			class="lightbox-close"
			aria-label="Close"
			onclick={() => (lightbox = null)}
		>
			<Icon name="x" size={16} />
		</button>
	</div>
{/if}

<style>
	.view-root {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		background: var(--surface);
	}

	/* ---------- outline rail ----------
	   Borderless — whitespace separates it from the reading column; the rail
	   should read as part of the page, not app chrome. */
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
		color: var(--muted-2);
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

	/* ---------- document ---------- */
	.md-host {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		padding: 36px 40px 96px;
		scroll-behavior: smooth;
	}

	.md-render {
		max-width: 740px;
		margin: 0 auto;
	}

	.md-empty {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--muted);
		font-size: 13.5px;
	}
	.md-empty p {
		margin: 0;
	}
	:global(.md-empty-icon) {
		color: var(--soft);
	}
	.md-empty-cta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
		padding: 7px 14px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--bg);
		background: var(--fg);
		border: 1px solid var(--fg);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.md-empty-cta:hover {
		opacity: 0.92;
	}

	/* ---------- comment trigger + popup ---------- */
	.cmt-trigger {
		position: absolute;
		transform: translate(-50%, -100%);
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 9px;
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		color: var(--bg);
		background: var(--fg);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		box-shadow: var(--shadow-md);
		z-index: 5;
	}
	.cmt-trigger:hover {
		opacity: 0.92;
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
		opacity: 0.5;
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

	/* ---------- lightbox ---------- */
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 220;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.lightbox-backdrop {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, #05060a 78%, transparent);
		border: none;
		cursor: zoom-out;
		backdrop-filter: blur(6px);
	}
	.lightbox-figure {
		position: relative;
		margin: 0;
		max-width: min(1100px, 92vw);
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		pointer-events: none;
	}
	.lightbox-figure img {
		max-width: 100%;
		max-height: 84vh;
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
	}
	.lightbox-figure figcaption {
		font-size: 12.5px;
		color: rgba(255, 255, 255, 0.82);
	}
	.lightbox-close {
		position: absolute;
		top: 18px;
		right: 20px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		color: rgba(255, 255, 255, 0.9);
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 9px;
		cursor: pointer;
	}
	.lightbox-close:hover {
		background: rgba(255, 255, 255, 0.16);
	}

	@media (max-width: 1080px) {
		.outline {
			display: none;
		}
	}
	@media (max-width: 720px) {
		.md-host {
			padding: 24px 20px 80px;
		}
	}
</style>
