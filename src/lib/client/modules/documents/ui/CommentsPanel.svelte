<script lang="ts">
	import Icon from '$lib/client/components/Icon.svelte';
	import { colorForKey, initialFor } from '$lib/client/utils/color';
	import { comments, type Comment } from '../comments.svelte';

	type Props = {
		documentId: string;
		/** Called when the user clicks a thread — let the parent scroll the
		 *  rendered view to the comment's highlighted span. */
		onJump?: (commentId: string) => void;
		/** Highlight a specific thread (e.g. the one the user just clicked in
		 *  the rendered view). Auto-focuses its reply input on change. */
		focusThreadId?: string | null;
	};
	let { documentId, onJump, focusThreadId = null }: Props = $props();

	const threads = $derived(comments.threads.filter((t) => t.documentId === documentId));

	const replyDrafts = $state<Record<string, string>>({});
	const sending = $state<Record<string, boolean>>({});

	function relative(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) {
			return 'just now';
		}
		const m = Math.floor(diff / 60_000);
		if (m < 60) {
			return `${m}m ago`;
		}
		const h = Math.floor(m / 60);
		if (h < 24) {
			return `${h}h ago`;
		}
		return `${Math.floor(h / 24)}d ago`;
	}

	function nameFor(c: Comment): string {
		if (!c.authorEmail) {
			return 'unknown';
		}
		const at = c.authorEmail.indexOf('@');
		return at > 0 ? c.authorEmail.slice(0, at) : c.authorEmail;
	}

	async function sendReply(threadId: string) {
		const draft = replyDrafts[threadId]?.trim();
		if (!draft || sending[threadId]) {
			return;
		}
		sending[threadId] = true;
		const ok = await comments.reply(documentId, threadId, draft);
		sending[threadId] = false;
		if (ok) {
			replyDrafts[threadId] = '';
		}
	}

	function onReplyKeydown(e: KeyboardEvent, threadId: string) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			sendReply(threadId);
		}
	}

	// When the focused thread changes, scroll its row into view + focus the
	// reply input. Uses an attachment on the threads list so the read of
	// `focusThreadId` triggers re-runs.
	let listEl: HTMLDivElement | null = $state(null);
	const focusOnChange: import('svelte/attachments').Attachment = () => {
		const id = focusThreadId;
		if (!id || !listEl) {
			return;
		}
		queueMicrotask(() => {
			const card = listEl?.querySelector<HTMLElement>(`[data-thread-id="${id}"]`);
			card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			const input = card?.querySelector<HTMLTextAreaElement>('.reply-input');
			input?.focus();
		});
	};
</script>

<aside class="panel">
	<header class="head">
		<Icon name="mail" size={13} />
		<span class="title">Threads</span>
		<span class="count">{threads.length}</span>
	</header>

	{#if comments.loading}
		<p class="muted">Loading…</p>
	{:else if comments.error}
		<p class="muted error">{comments.error}</p>
	{:else if threads.length === 0}
		<p class="muted">No threads yet. Select text in the document to start one.</p>
	{:else}
		<div bind:this={listEl} class="list" {@attach focusOnChange}>
			{#each threads as t (t.id)}
				{@const focused = t.id === focusThreadId}
				{@const orphaned = comments.isOrphan(t.id)}
				<article class="thread" class:focused class:orphaned data-thread-id={t.id}>
					<button
						type="button"
						class="quote"
						class:quote-orphan={orphaned}
						title={orphaned
							? 'The quoted text no longer appears in this document — anchor lost'
							: 'Jump to the highlighted text'}
						onclick={() => onJump?.(t.id)}
						disabled={orphaned}
					>
						"{t.anchorQuote ?? ''}"
					</button>
					{#if orphaned}
						<span class="orphan-pill">
							<Icon name="alert-circle" size={10} />
							<span>Anchor lost</span>
						</span>
					{/if}

					<div class="messages">
						{@render messageItem(t)}
						{#each t.replies as r (r.id)}
							{@render messageItem(r)}
						{/each}
					</div>

					<form
						class="reply"
						onsubmit={(e) => {
							e.preventDefault();
							sendReply(t.id);
						}}
					>
						<textarea
							class="reply-input"
							placeholder="Reply…"
							rows="1"
							value={replyDrafts[t.id] ?? ''}
							oninput={(e) => {
								if (e.currentTarget instanceof HTMLTextAreaElement) {
									replyDrafts[t.id] = e.currentTarget.value;
								}
							}}
							onkeydown={(e) => onReplyKeydown(e, t.id)}
						></textarea>
						<button
							type="submit"
							class="send"
							title="Send (⌘↵)"
							aria-label="Send reply"
							disabled={!replyDrafts[t.id]?.trim() || sending[t.id]}
						>
							{sending[t.id] ? '…' : 'Send'}
						</button>
					</form>
				</article>
			{/each}
		</div>
	{/if}
</aside>

{#snippet messageItem(msg: Comment)}
	{@const color = colorForKey(msg.createdBy ?? msg.id)}
	<div class="msg">
		<span class="avatar" style="--from: {color.from}; --to: {color.to};" aria-hidden="true">
			{initialFor(nameFor(msg))}
		</span>
		<div class="msg-body">
			<div class="msg-head">
				<span class="msg-author">{nameFor(msg)}</span>
				<span class="msg-time">{relative(msg.createdAt)}</span>
				<button
					type="button"
					class="msg-del"
					title="Delete"
					aria-label="Delete message"
					onclick={() => comments.remove(documentId, msg.id)}
				>
					<Icon name="trash" size={10} />
				</button>
			</div>
			<div class="msg-text">{msg.body}</div>
		</div>
	</div>
{/snippet}

<style>
	.panel {
		width: 320px;
		flex: 0 0 320px;
		border-left: 1px solid var(--border);
		background: var(--accents-1);
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
		font-weight: 600;
		color: var(--geist-foreground);
	}
	.head .count {
		margin-left: auto;
		font-size: 11px;
		font-weight: 500;
		color: var(--accents-5);
	}
	.muted {
		padding: 16px;
		margin: 0;
		font-size: 12px;
		color: var(--accents-5);
	}
	.muted.error {
		color: var(--geist-error);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 10px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.thread {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		transition:
			border-color 120ms,
			box-shadow 120ms;
	}
	.thread.focused {
		border-color: var(--accent, var(--geist-foreground));
		box-shadow: 0 0 0 3px var(--accent-soft, rgba(0, 0, 0, 0.04));
	}

	.quote {
		display: block;
		width: 100%;
		text-align: left;
		font: inherit;
		font-size: 11.5px;
		color: var(--accents-6);
		font-style: italic;
		background: transparent;
		border: none;
		border-left: 2px solid var(--saffron, var(--accents-3));
		padding: 2px 0 2px 8px;
		cursor: pointer;
		max-height: 48px;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.quote:hover {
		color: var(--geist-foreground);
	}
	.quote-orphan {
		border-left-color: var(--rose);
		cursor: not-allowed;
		opacity: 0.85;
	}
	.quote-orphan:hover {
		color: var(--accents-6);
	}
	/* Small pill that appears under the quote when the thread's anchored
	   text can no longer be located in the rendered document — usually
	   because the document was restructured (heading split, paragraph
	   rewritten) after the comment was made. */
	.orphan-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-top: 4px;
		padding: 2px 7px;
		font-size: 10.5px;
		font-weight: 500;
		color: var(--rose);
		background: color-mix(in srgb, var(--rose) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--rose) 30%, transparent);
		border-radius: 999px;
		width: fit-content;
	}

	.messages {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.msg {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		font-size: 10px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.96);
		background: linear-gradient(135deg, var(--from), var(--to));
		border-radius: 50%;
	}
	.msg-body {
		flex: 1;
		min-width: 0;
	}
	.msg-head {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-bottom: 1px;
	}
	.msg-author {
		font-size: 12px;
		font-weight: 600;
		color: var(--geist-foreground);
	}
	.msg-time {
		font-size: 10.5px;
		color: var(--accents-5);
	}
	.msg-del {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		color: var(--accents-5);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 100ms;
	}
	.msg:hover .msg-del {
		opacity: 1;
	}
	.msg-del:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}
	.msg-text {
		font-size: 13px;
		line-height: 1.45;
		color: var(--geist-foreground);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.reply {
		display: flex;
		gap: 6px;
		align-items: flex-end;
		padding-top: 6px;
		border-top: 1px dashed var(--border);
	}
	.reply-input {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		font: inherit;
		font-size: 12.5px;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		outline: none;
		resize: none;
		min-height: 28px;
		max-height: 100px;
	}
	.reply-input:focus {
		border-color: var(--accent, var(--geist-foreground));
		background: var(--surface);
	}
	.send {
		padding: 6px 10px;
		font: inherit;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--geist-background);
		background: var(--geist-foreground);
		border: 1px solid var(--geist-foreground);
		border-radius: 6px;
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
