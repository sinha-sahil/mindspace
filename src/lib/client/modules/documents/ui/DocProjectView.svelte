<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { Button, Tooltip } from '@juspay/svelte-ui-components';
	import Icon, { type IconName } from '$lib/client/components/Icon.svelte';
	import { toasts } from '$lib/client/modules/toasts';
	import { documents } from '../store.svelte';
	import { comments } from '../comments.svelte';
	import MarkdownView from './MarkdownView.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import CommentsPanel from './CommentsPanel.svelte';
	import type { AppSupabaseClient } from '../../../../../app';

	type Props = {
		projectId: string;
		supabase: AppSupabaseClient | null;
	};
	let { projectId, supabase }: Props = $props();

	let mode = $state<'view' | 'edit'>('view');
	let focusedThreadId = $state<string | null>(null);

	// Inline rename of the active document.
	let titleEditing = $state(false);
	let titleDraft = $state('');
	let titleInputEl: HTMLInputElement | null = $state(null);

	// Hidden file input for disk upload.
	let fileInputEl: HTMLInputElement | null = $state(null);
	let uploading = $state(false);

	let refreshing = $state(false);

	async function refreshDocs() {
		if (refreshing) {
			return;
		}
		refreshing = true;
		try {
			await documents.refresh();
			const id = documents.activeId;
			if (id) {
				// Pull fresh comments for whichever doc is now active — its
				// resolved/anchor state may have changed from another tab or
				// from an MCP-driven update.
				await comments.loadFor(id);
			}
		} catch (e) {
			toasts.error('Could not refresh documents', {
				description: e instanceof Error ? e.message : 'Unknown error'
			});
		} finally {
			refreshing = false;
		}
	}

	const loadDocs: Attachment = () => {
		if (supabase) {
			documents.loadFor(supabase, projectId);
		}
	};

	const loadActiveComments: Attachment = () => {
		const id = documents.activeId;
		if (id) {
			comments.loadFor(id);
		}
		// When the doc switches, drop the focused-thread highlight.
		focusedThreadId = null;
	};

	async function newDoc() {
		const created = await documents.add();
		if (created) {
			toasts.success('Document created', { description: created.name });
			mode = 'edit';
		}
	}

	function removeDoc(id: string, name: string) {
		if (!confirm(`Delete "${name}"? Comments on it will also be removed.`)) {
			return;
		}
		documents.remove(id);
	}

	function startTitleEdit(name: string) {
		titleDraft = name;
		titleEditing = true;
		queueMicrotask(() => titleInputEl?.select());
	}

	async function commitTitleEdit(id: string, originalName: string) {
		if (!titleEditing) {
			return;
		}
		titleEditing = false;
		const next = titleDraft.trim();
		if (!next || next === originalName) {
			return;
		}
		await documents.rename(id, next);
	}

	function onTitleKeydown(e: KeyboardEvent, id: string, originalName: string) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitTitleEdit(id, originalName);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			titleEditing = false;
		}
	}

	function pickFile() {
		fileInputEl?.click();
	}

	async function onFilePicked(e: Event) {
		const target = e.currentTarget;
		if (!(target instanceof HTMLInputElement) || !target.files || target.files.length === 0) {
			return;
		}
		uploading = true;
		const failures: string[] = [];
		for (const file of Array.from(target.files)) {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/projects/${projectId}/documents`, {
				method: 'POST',
				body: fd
			});
			if (!res.ok) {
				failures.push(`${file.name} — ${res.status}`);
			}
		}
		target.value = '';
		uploading = false;
		if (failures.length > 0) {
			toasts.error('Some uploads failed', { description: failures.join(', ') });
		} else {
			toasts.success(target.files?.length === 1 ? 'Document uploaded' : 'Documents uploaded');
		}
		// Re-load the doc list to pick up new uploads (the store insert path
		// only handles in-app creation).
		if (supabase) {
			documents.reset();
			await documents.loadFor(supabase, projectId);
		}
	}

	function jumpToComment(commentId: string) {
		// Both: scroll the rendered view to the highlighted span, AND focus
		// the thread in the side panel for visual emphasis.
		focusedThreadId = commentId;
		const mark = document.querySelector(`mark.comment-mark[data-comment-id="${commentId}"]`);
		if (mark instanceof HTMLElement) {
			mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	function onMarkClick(commentId: string) {
		focusedThreadId = commentId;
	}

	// Pick a glyph that hints at a document's contents from its name, so the
	// file list reads at a glance instead of a wall of identical pencils.
	function docIcon(name: string): IconName {
		const t = name.toLowerCase();
		if (/overview|tl;?dr|summary|index|readme|contents?/.test(t)) return 'list';
		if (/research|industry|study|analysis|insight/.test(t)) return 'book';
		if (/road ?map|timeline|phase|roadmap|schedule|milestone/.test(t)) return 'calendar';
		if (/data|model|schema|spec|table|matrix/.test(t)) return 'table';
		if (/cost|budget|pric|finance|revenue|risk|metric/.test(t)) return 'hash';
		if (/market|survival|gtm|go.to.market|growth|sales|launch/.test(t)) return 'star';
		if (/stack|compiler|code|api|engine|tech|hosting|deploy|build|infra/.test(t)) return 'code';
		if (/publish|rollback|release|version|changelog/.test(t)) return 'refresh';
		if (/design|layout|component|wireframe|mockup|ux|ui\b/.test(t)) return 'layout';
		if (/image|asset|media|photo|diagram|figure/.test(t)) return 'image';
		return 'file-text';
	}
</script>

<section class="layout" {@attach loadDocs}>
	<aside class="files">
		<header class="files-head">
			<span class="files-title">Documents</span>
			<div class="files-actions">
				<Tooltip text="Refresh documents" position="bottom">
					<Button
						classes="btn-icon"
						ariaLabel="Refresh documents"
						disabled={refreshing}
						showLoader={refreshing}
						loaderType="Circular"
						onclick={refreshDocs}
					>
						{#snippet icon()}
							{#if !refreshing}<Icon name="refresh" size={12} />{/if}
						{/snippet}
					</Button>
				</Tooltip>
				<button
					type="button"
					class="icon-btn"
					title="Upload .md file"
					aria-label="Upload markdown file"
					onclick={pickFile}
					disabled={uploading}
				>
					<Icon name="arrow-up-right" size={12} />
				</button>
				<button
					type="button"
					class="icon-btn primary"
					title="New document"
					aria-label="New document"
					onclick={newDoc}
				>
					<Icon name="plus" size={14} />
				</button>
			</div>
		</header>

		<input
			bind:this={fileInputEl}
			type="file"
			accept=".md,.markdown,text/markdown,text/plain"
			multiple
			class="file-input"
			onchange={onFilePicked}
		/>

		{#if documents.loading}
			<p class="muted">Loading…</p>
		{:else if documents.items.length === 0}
			<p class="muted">No documents yet. Hit "New" to start one or upload a .md file.</p>
		{:else}
			<ul class="file-list">
				{#each documents.items as doc (doc.id)}
					{@const active = doc.id === documents.activeId}
					<li>
						<div class="file-row" class:active>
							<button
								type="button"
								class="file-btn"
								onclick={() => {
									documents.select(doc.id);
									mode = 'view';
									titleEditing = false;
								}}
							>
								<Icon name={docIcon(doc.name)} size={13} class="file-icon" />
								<span class="file-name">{doc.name}</span>
							</button>
							<button
								type="button"
								class="file-del"
								title="Delete"
								aria-label="Delete document"
								onclick={() => removeDoc(doc.id, doc.name)}
							>
								<Icon name="trash" size={11} />
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</aside>

	<main class="doc-pane" {@attach loadActiveComments}>
		{#if documents.active}
			{@const doc = documents.active}
			<header class="doc-head">
				{#if titleEditing}
					<input
						bind:this={titleInputEl}
						class="doc-title-input"
						bind:value={titleDraft}
						onblur={() => commitTitleEdit(doc.id, doc.name)}
						onkeydown={(e) => onTitleKeydown(e, doc.id, doc.name)}
						maxlength="200"
						aria-label="Document name"
					/>
				{:else}
					<button
						type="button"
						class="doc-title-btn"
						ondblclick={() => startTitleEdit(doc.name)}
						title="Double-click to rename"
					>
						{doc.name}
					</button>
				{/if}
				<div class="head-right">
					<span class="save-pill" class:saving={documents.isSaving}>
						<span class="dot"></span>{documents.isSaving ? 'Saving' : 'Saved'}
					</span>
					<div class="mode-toggle" role="tablist" aria-label="View mode">
						<button
							type="button"
							class="mode-btn"
							class:active={mode === 'view'}
							role="tab"
							aria-selected={mode === 'view'}
							onclick={() => (mode = 'view')}
						>
							View
						</button>
						<button
							type="button"
							class="mode-btn"
							class:active={mode === 'edit'}
							role="tab"
							aria-selected={mode === 'edit'}
							onclick={() => (mode = 'edit')}
						>
							Edit
						</button>
					</div>
				</div>
			</header>

			<div class="doc-body">
				{#key doc.id + ':' + mode}
					{#if mode === 'view'}
						<MarkdownView documentId={doc.id} content={doc.content} onSelectThread={onMarkClick} />
					{:else}
						<MarkdownEditor documentId={doc.id} content={doc.content} />
					{/if}
				{/key}
			</div>
		{:else}
			<div class="empty">
				<p>No document selected.</p>
				<button type="button" class="empty-cta" onclick={newDoc}>
					<Icon name="plus" size={12} />
					<span>Create your first document</span>
				</button>
			</div>
		{/if}
	</main>

	{#if documents.active}
		{@const doc = documents.active}
		{#key doc.id}
			<CommentsPanel documentId={doc.id} onJump={jumpToComment} focusThreadId={focusedThreadId} />
		{/key}
	{/if}
</section>

<style>
	.layout {
		flex: 1;
		display: flex;
		min-width: 0;
		min-height: 0;
		background: var(--surface);
	}

	.files {
		width: 220px;
		flex: 0 0 220px;
		border-right: 1px solid var(--border);
		background: var(--accents-1);
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.files-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 12px 12px 14px;
		border-bottom: 1px solid var(--border);
		gap: 8px;
	}
	.files-title {
		min-width: 0;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--accents-5);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.files-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.icon-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--accents-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		cursor: pointer;
	}
	.icon-btn:hover:not(:disabled) {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
	}
	.icon-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.icon-btn.primary {
		color: var(--geist-background);
		background: var(--geist-foreground);
		border-color: var(--geist-foreground);
	}
	.icon-btn.primary:hover:not(:disabled) {
		color: var(--geist-background);
		border-color: var(--geist-foreground);
		opacity: 0.9;
	}
	.file-input {
		display: none;
	}

	.file-list {
		list-style: none;
		padding: 6px;
		margin: 0;
		overflow-y: auto;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.file-row {
		display: flex;
		align-items: stretch;
		gap: 2px;
		border-radius: 6px;
		transition: background 100ms;
	}
	.file-row:hover {
		background: var(--surface);
	}
	.file-row.active {
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.file-btn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
	}
	.file-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.file-icon) {
		color: var(--accents-5);
	}
	.file-row:hover :global(.file-icon),
	.file-row.active :global(.file-icon) {
		color: var(--geist-foreground);
	}
	.file-del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 100ms;
	}
	.file-row:hover .file-del,
	.file-row.active .file-del {
		opacity: 1;
	}
	.file-del:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}

	.doc-pane {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface);
	}
	.doc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 20px;
		border-bottom: 1px solid var(--border);
		min-height: 48px;
	}
	.doc-title-btn {
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
	.doc-title-btn:hover {
		background: var(--accents-1);
	}
	.doc-title-input {
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

	.mode-toggle {
		display: inline-flex;
		padding: 2px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.mode-btn {
		padding: 3px 10px;
		font: inherit;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--accents-6);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	.mode-btn.active {
		color: var(--geist-foreground);
		background: var(--surface);
	}

	.doc-body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.doc-body :global(> *) {
		flex: 1;
		min-height: 0;
	}

	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--accents-5);
		font-size: 13px;
	}
	.empty-cta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-background);
		background: var(--geist-foreground);
		border: 1px solid var(--geist-foreground);
		border-radius: 7px;
		cursor: pointer;
	}

	.muted {
		padding: 12px 16px;
		margin: 0;
		font-size: 12px;
		color: var(--accents-5);
	}
</style>
