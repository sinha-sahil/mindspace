<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { onMount } from 'svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { toasts } from '$lib/client/modules/toasts';
	import { comments } from '../comments.svelte';
	import {
		renderMarkdown,
		renderMermaidDiagrams,
		anchorFromSelection,
		applyHighlights,
		type Anchor
	} from '../markdown';

	type Props = {
		documentId: string;
		content: string;
		/** Fired when the user clicks an existing comment highlight. */
		onSelectThread?: (commentId: string) => void;
	};
	let { documentId, content, onSelectThread }: Props = $props();

	const html = $derived(renderMarkdown(content));

	// A version key that changes when content OR comment set changes — used
	// by {#key} below to throw away the DOM (and any previously-applied
	// <mark> wrappers) so highlights re-apply against a clean slate.
	const version = $derived(`${content.length}::${comments.items.map((c) => c.id).join(',')}`);

	// Floating add-comment popup state.
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
			// to the container. Clamp X so the popup (320px wide, centered via
			// translate(-50%)) stays inside the host even when the selection is
			// near the left or right edge — otherwise the popup spills under the
			// file tree or off the comments panel.
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) {
				return;
			}
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			const cRect = containerEl.getBoundingClientRect();
			const rawX = rect.left - cRect.left + rect.width / 2;
			const POPUP_HALF_WIDTH = 160; // matches .cmt-popup width 320 / 2
			const EDGE_PAD = 12;
			const hostWidth = containerEl.clientWidth;
			popupX = Math.max(
				POPUP_HALF_WIDTH + EDGE_PAD,
				Math.min(hostWidth - POPUP_HALF_WIDTH - EDGE_PAD, rawX)
			);
			// Y: keep the trigger above the selection. The form will appear
			// just below the selection (popupY + 12).
			popupY = rect.top - cRect.top - 8;
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
	// a11y lint correctly flags handler attributes on plain <div>s. Listening
	// imperatively keeps the listener without the false-positive warning.
	const captureSelection: Attachment<HTMLDivElement> = (node) => {
		node.addEventListener('mouseup', onMouseUp);
		return () => node.removeEventListener('mouseup', onMouseUp);
	};

	// Click delegation on the rendered container: a click on a saved
	// highlight fires onSelectThread with its thread (root) id.
	const captureMarkClicks: Attachment<HTMLDivElement> = (node) => {
		function handle(e: MouseEvent) {
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
		node.addEventListener('click', handle);
		return () => node.removeEventListener('click', handle);
	};

	// Highlight saved comments on the rendered DOM. Re-runs when `version`
	// changes (the {#key} block remounts the container, which re-runs this).
	// Only thread roots carry an anchor (replies inherit context from the
	// root), so reply rows with null anchor fields are skipped.
	const highlightSaved: Attachment<HTMLDivElement> = (node) => {
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
		// Publish to the store so CommentsPanel can badge orphaned threads.
		comments.setOrphans(orphans);
	};

	// Upgrade mermaid placeholders to SVG after the markdown is rendered. Runs
	// when the container is (re)created by the {#key} block — i.e. on every
	// content change — so edited diagrams re-render against a clean DOM.
	const renderDiagrams: Attachment<HTMLDivElement> = (node) => {
		renderMermaidDiagrams(node);
	};

	onMount(() => {
		// onMount runs browser-only; the returned cleanup runs on unmount.
		// Using this pattern instead of a separate onDestroy avoids reaching
		// for `document` during SSR.
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	});
</script>

<div class="md-host" {@attach captureSelection}>
	{#key version}
		<div
			bind:this={containerEl}
			class="md-render"
			role="article"
			{@attach highlightSaved}
			{@attach captureMarkClicks}
			{@attach renderDiagrams}
		>
			{@html html}
		</div>
	{/key}

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

<style>
	.md-host {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 24px 32px 64px;
	}

	.md-render {
		max-width: 720px;
		margin: 0 auto;
		font-size: 14px;
		line-height: 1.65;
		color: var(--geist-foreground);
	}
	.md-render :global(h1),
	.md-render :global(h2),
	.md-render :global(h3),
	.md-render :global(h4) {
		font-weight: 600;
		letter-spacing: -0.01em;
		margin: 1.8em 0 0.6em;
		line-height: 1.25;
	}
	.md-render :global(h1) {
		font-size: 1.7em;
		margin-top: 0;
	}
	.md-render :global(h2) {
		font-size: 1.3em;
	}
	.md-render :global(h3) {
		font-size: 1.1em;
	}
	.md-render :global(p) {
		margin: 0.75em 0;
	}
	.md-render :global(ul),
	.md-render :global(ol) {
		padding-left: 1.5em;
		margin: 0.75em 0;
	}
	.md-render :global(li) {
		margin: 0.25em 0;
	}
	.md-render :global(code) {
		font-family: var(--font-mono);
		font-size: 0.88em;
		padding: 1px 5px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.md-render :global(pre) {
		font-family: var(--font-mono);
		font-size: 12.5px;
		padding: 14px 16px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow-x: auto;
		margin: 1em 0;
	}
	.md-render :global(pre code) {
		padding: 0;
		background: transparent;
		border: none;
	}
	/* Mermaid: drop the code-block chrome and center the rendered SVG. */
	.md-render :global(pre.mermaid-diagram) {
		position: relative;
		padding: 0;
		background: transparent;
		border: none;
		text-align: center;
	}
	.md-render :global(pre.mermaid-diagram svg) {
		max-width: 100%;
		height: auto;
	}
	/* Fullscreen trigger — fades in on diagram hover, top-right corner. */
	.md-render :global(.mermaid-fullscreen-btn) {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		color: var(--accents-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--duration-fast, 120ms) var(--ease-out, ease);
	}
	.md-render :global(pre.mermaid-diagram:hover .mermaid-fullscreen-btn),
	.md-render :global(.mermaid-fullscreen-btn:focus-visible) {
		opacity: 1;
	}
	.md-render :global(.mermaid-fullscreen-btn:hover) {
		color: var(--geist-foreground);
		background: var(--accents-1);
	}
	.md-render :global(.mermaid-fullscreen-btn svg) {
		width: 15px;
		height: 15px;
	}
	.md-render :global(pre.mermaid-error) {
		text-align: left;
		color: var(--geist-error, #e00);
		white-space: pre-wrap;
	}
	.md-render :global(blockquote) {
		margin: 1em 0;
		padding: 0 1em;
		border-left: 3px solid var(--accents-3);
		color: var(--accents-6);
	}
	.md-render :global(a) {
		color: var(--accent, var(--geist-foreground));
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.md-render :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 2em 0;
	}
	.md-render :global(table) {
		border-collapse: collapse;
		margin: 1em 0;
	}
	.md-render :global(th),
	.md-render :global(td) {
		padding: 6px 12px;
		border: 1px solid var(--border);
		text-align: left;
	}
	/* Comment highlights — theme-aware via color-mix on the --saffron token.
	   Dark mode auto-uses #fbbf24, light mode #f5a524, so we never hardcode
	   an rgba that's too hot in one theme and too dim in the other. Underline
	   instead of a thick border so multi-line and inline-code-containing
	   spans don't get a boxy outline. */
	.md-render :global(.comment-mark) {
		background: color-mix(in srgb, var(--saffron) 14%, transparent);
		box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--saffron) 55%, transparent);
		padding: 0 1px;
		border-radius: 2px;
		cursor: pointer;
		transition: background var(--duration-fast, 120ms) var(--ease-out, ease);
	}
	.md-render :global(.comment-mark:hover) {
		background: color-mix(in srgb, var(--saffron) 26%, transparent);
	}

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
		color: var(--geist-background);
		background: var(--geist-foreground);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		box-shadow: var(--shadow-medium);
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
		box-shadow: var(--shadow-medium);
		z-index: 6;
	}
	.cmt-quote {
		font-size: 12px;
		color: var(--accents-6);
		background: var(--accents-1);
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
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		outline: none;
		resize: vertical;
		min-height: 60px;
	}
	.cmt-input:focus {
		border-color: var(--accent, var(--geist-foreground));
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
		color: var(--accents-6);
		background: transparent;
		border-color: var(--border);
	}
	.btn.primary {
		color: var(--geist-background);
		background: var(--geist-foreground);
		border-color: var(--geist-foreground);
	}
</style>
