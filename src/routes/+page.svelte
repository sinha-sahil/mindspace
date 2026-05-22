<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '@juspay/svelte-ui-components';
	import Icon from '$lib/client/components/Icon.svelte';
	import { Sidebar } from "$lib/client/modules/sidebar";
	import { Whiteboard, collab } from "$lib/client/modules/whiteboard";
	import { colorForKey, initialFor } from '$lib/client/utils/color';
	import { projects, type Visibility } from '$lib/client/modules/projects';
	import { workspaces } from '$lib/client/modules/workspaces';
	import { CommandPalette, commandPalette } from '$lib/client/modules/command-palette';
	import { toasts } from '$lib/client/modules/toasts';

	let { data } = $props();
	const { supabase, user, isAdmin } = $derived(data);

	let lastErrorSeen = $state('');

	onMount(() => {
		workspaces.onActiveChange((sb, wsId) => projects.loadFor(sb, wsId));
		if (user) {
			workspaces.init(supabase, user.id);
		}
	});

	function surfaceErrors() {
		const err = projects.error ?? workspaces.error ?? '';
		if (err && err !== lastErrorSeen) {
			lastErrorSeen = err;
			toasts.error('Something went wrong', { description: err });
		}
	}

	function handleChange(scene: string) {
		const id = projects.activeId;
		if (!id) {return;}
		projects.saveScene(id, scene);
	}

	function relative(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) {return 'just now';}
		const m = Math.floor(diff / 60000);
		if (m < 60) {return `${m}m ago`;}
		const h = Math.floor(m / 60);
		if (h < 24) {return `${h}h ago`;}
		return `${Math.floor(h / 24)}d ago`;
	}

	let shareOpen = $state(false);
	let copied = $state(false);

	// Inline-edit for the project title in the top bar.
	let titleEditing = $state(false);
	let titleDraft = $state('');
	let titleInputEl: HTMLInputElement | null = $state(null);

	function startTitleEdit() {
		const active = projects.active;
		if (!active) {
			return;
		}
		titleDraft = active.name;
		titleEditing = true;
		queueMicrotask(() => titleInputEl?.select());
	}

	function commitTitleEdit() {
		if (!titleEditing) {
			return;
		}
		titleEditing = false;
		const id = projects.activeId;
		const next = titleDraft.trim();
		if (!id || !next || next === projects.active?.name) {
			return;
		}
		projects.rename(id, next);
	}

	function cancelTitleEdit() {
		titleEditing = false;
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitTitleEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelTitleEdit();
		}
	}

	const publicUrl = $derived.by(() => {
		const id = projects.active?.id;
		if (!id || typeof window === 'undefined') {return '';}
		return `${window.location.origin}/p/${id}`;
	});

	async function copyShareUrl() {
		if (!publicUrl) {
			return;
		}
		try {
			await navigator.clipboard.writeText(publicUrl);
			copied = true;
			toasts.success('Link copied', { description: publicUrl });
			setTimeout(() => (copied = false), 1500);
		} catch {
			toasts.error('Could not copy', { description: 'Clipboard blocked by the browser.' });
		}
	}

	function setVisibility(v: Visibility) {
		const id = projects.activeId;
		if (!id) {
			return;
		}
		projects.setVisibility(id, v);
		toasts.info(v === 'link' ? 'Project is now public' : 'Project is private');
	}

	function closeShareOnOutside(e: MouseEvent) {
		const t = e.target;
		if (!(t instanceof Element)) {
			return;
		}
		if (!t.closest('.share-trigger') && !t.closest('.share-menu')) {
			shareOpen = false;
		}
	}

	$effect.pre(() => {
		void projects.error;
		void workspaces.error;
		surfaceErrors();
	});

	const platformMod = $derived.by(() => {
		if (typeof navigator === 'undefined') {
			return 'Ctrl';
		}
		return /mac|iphone|ipad/i.test(navigator.platform) ? '⌘' : 'Ctrl';
	});
</script>

<svelte:window onmousedown={closeShareOnOutside} />

<div class="app">
	<Sidebar userEmail={user?.email ?? ''} userId={user?.id ?? ''} {isAdmin} />

	<main class="main">
		{#if workspaces.loading || projects.loading}
			<div class="empty">
				<p class="muted">Loading…</p>
			</div>
		{:else if projects.active}
			{@const active = projects.active}
			<header class="thin-bar">
				<div class="title-block">
					{#if titleEditing}
						<input
							bind:this={titleInputEl}
							bind:value={titleDraft}
							onkeydown={handleTitleKeydown}
							onblur={commitTitleEdit}
							class="project-title-input"
							maxlength="200"
							aria-label="Project title"
						/>
					{:else}
						<h1 class="project-title">
							<button
								type="button"
								class="project-title-btn"
								title="Click to rename"
								onclick={startTitleEdit}
							>
								{active.name}
							</button>
						</h1>
					{/if}
					<span class="meta">Updated {relative(active.updatedAt)}</span>
					{#if collab.peers.length > 0}
						<div class="presence-stack" aria-label="People viewing this project">
							{#each collab.peers.slice(0, 5) as peer (peer.id)}
								<span
									class="presence-avatar"
									title={peer.email}
									style="--from: {peer.color.from}; --to: {peer.color.to};"
								>
									{initialFor(peer.name)}
								</span>
							{/each}
							{#if collab.peers.length > 5}
								<span class="presence-more" title="and more">
									+{collab.peers.length - 5}
								</span>
							{/if}
						</div>
					{/if}
				</div>
				<div class="topbar-right">
					<button
						class="cmdk-trigger"
						title="Open command palette"
						onclick={() => commandPalette.setOpen(true)}
					>
						<Icon name="search" size={13} />
						<span>Search…</span>
						<kbd class="cmdk-kbd">{platformMod} K</kbd>
					</button>
					<div class="share-wrap">
						<button
							class="share-trigger"
							class:public={active.visibility === 'link'}
							onclick={() => (shareOpen = !shareOpen)}
							title="Sharing"
						>
							<Icon
								name={active.visibility === 'link' ? 'link' : 'lock'}
								size={12}
								class="share-trigger-icon"
							/>
							<span>{active.visibility === 'link' ? 'Anyone with link' : 'Private'}</span>
						</button>
						{#if shareOpen}
							<div class="share-menu" role="dialog" aria-label="Sharing">
								<div class="menu-section-label">Who can access</div>
								<button
									class="menu-row"
									class:active={active.visibility === 'private'}
									onclick={() => setVisibility('private')}
								>
									<div class="menu-row-icon"><Icon name="lock" size={14} /></div>
									<div class="menu-row-text">
										<div class="menu-row-title">Private</div>
										<div class="menu-row-sub">Only you can see this project.</div>
									</div>
								</button>
								<button
									class="menu-row"
									class:active={active.visibility === 'link'}
									onclick={() => setVisibility('link')}
								>
									<div class="menu-row-icon"><Icon name="link" size={14} /></div>
									<div class="menu-row-text">
										<div class="menu-row-title">Anyone with the link</div>
										<div class="menu-row-sub">View-only. They don't need an account.</div>
									</div>
								</button>

								{#if active.visibility === 'link'}
									<div class="copy-row">
										<input class="copy-input" readonly value={publicUrl} />
										<button class="copy-btn" onclick={copyShareUrl}>
											{copied ? 'Copied' : 'Copy'}
										</button>
									</div>
								{/if}
							</div>
						{/if}
					</div>
					<span class="save-state" class:saving={projects.isSaving}>
						<span class="save-dot"></span>
						<span>{projects.isSaving ? 'Saving' : 'Saved'}</span>
					</span>
				</div>
			</header>

			<div class="board">
				{#key active.id}
					<Whiteboard
						scene={active.scene}
						onChange={handleChange}
						{supabase}
						projectId={active.id}
						userId={user?.id ?? null}
						userEmail={user?.email ?? null}
					/>
				{/key}
			</div>
		{:else}
			<div class="empty">
				<div class="empty-card">
					<h2>This workspace is empty</h2>
					<p>Create your first project to start drawing.</p>
					<Button text="+ New project" onclick={() => projects.add()} />
				</div>
			</div>
		{/if}

	</main>
</div>

<CommandPalette {isAdmin} />

<style>
	:global(html, body) {
		height: 100%;
	}
	:global(body > div[style*='display: contents']) {
		height: 100%;
	}

	.app {
		display: flex;
		height: 100vh;
		min-height: 0;
		overflow: hidden;
	}

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--surface);
		position: relative;
	}

	.thin-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		min-height: 44px;
	}
	.title-block {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
		/* Take any space topbar-right doesn't claim, so the title only
		   ellipsises when there's truly no room. */
		flex: 1 1 auto;
	}
	.project-title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
		min-width: 0;
		flex: 0 1 auto;
	}
	.project-title-btn {
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: inherit;
		background: transparent;
		border: none;
		padding: 2px 6px;
		margin: -2px -6px;
		border-radius: 5px;
		cursor: text;
		text-align: left;
		/* width: max-content sizes the button to its text so the hover
		   background hugs the title; max-width caps it at the h1 so ellipsis
		   still triggers when squeezed. */
		display: block;
		width: max-content;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: background 120ms;
	}
	.project-title-btn:hover {
		background: var(--accents-1);
	}
	.project-title-btn:focus-visible {
		outline: 2px solid var(--accent, var(--geist-foreground));
		outline-offset: 1px;
	}
	.project-title-input {
		margin: -2px -6px;
		padding: 2px 6px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--border-strong, var(--border));
		border-radius: 5px;
		outline: none;
		min-width: 0;
		max-width: 360px;
		caret-color: var(--accent, var(--geist-success));
	}
	.project-title-input:focus {
		border-color: var(--accent, var(--geist-foreground));
		background: var(--surface);
	}
	.meta {
		font-size: 11px;
		color: var(--accents-5);
		flex: 0 0 auto;
		white-space: nowrap;
	}

	/* Presence stack — overlapping circular avatars showing live viewers. */
	.presence-stack {
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
		margin-left: 4px;
	}
	.presence-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		font-size: 10px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.96);
		background: linear-gradient(135deg, var(--from), var(--to));
		border: 2px solid var(--surface);
		border-radius: 50%;
		margin-left: -6px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}
	.presence-avatar:first-child {
		margin-left: 0;
	}
	.presence-more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 6px;
		margin-left: -6px;
		font-size: 10px;
		font-weight: 600;
		color: var(--accents-6);
		background: var(--accents-2);
		border: 2px solid var(--surface);
		border-radius: 11px;
	}

	.topbar-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.cmdk-trigger {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px 5px 10px;
		font: inherit;
		font-size: 12px;
		color: var(--accents-5);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 7px;
		cursor: pointer;
		transition:
			color 120ms,
			border-color 120ms,
			background 120ms;
	}
	.cmdk-trigger:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
		background: var(--surface);
	}
	.cmdk-trigger span {
		min-width: 90px;
		text-align: left;
	}
	.cmdk-kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		height: 18px;
		padding: 0 5px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accents-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 4px;
	}

	.share-wrap {
		position: relative;
	}
	.share-trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-6);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 7px;
		cursor: pointer;
		transition:
			color 120ms,
			border-color 120ms,
			background 120ms;
	}
	.share-trigger:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
	}
	.share-trigger.public {
		color: var(--geist-success);
		border-color: rgba(0, 112, 243, 0.4);
		background: rgba(0, 112, 243, 0.08);
	}
	:global(.share-trigger-icon) {
		opacity: 0.85;
	}

	.save-state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-5);
		border-radius: 7px;
	}
	.save-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--geist-success);
		box-shadow: 0 0 0 3px rgba(0, 112, 243, 0.18);
	}
	.save-state.saving .save-dot {
		background: var(--geist-warning);
		box-shadow: 0 0 0 3px rgba(245, 166, 35, 0.18);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}

	.share-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 50;
		width: 320px;
		padding: 6px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-medium);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.menu-section-label {
		padding: 6px 8px 4px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--accents-5);
	}
	.menu-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 8px 10px;
		font: inherit;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		width: 100%;
	}
	.menu-row:hover {
		background: var(--accents-1);
	}
	.menu-row.active {
		background: var(--accents-1);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.menu-row-icon {
		font-size: 14px;
		line-height: 1.2;
	}
	.menu-row-title {
		font-size: 13px;
		font-weight: 500;
	}
	.menu-row-sub {
		font-size: 11px;
		color: var(--accents-5);
		margin-top: 2px;
	}
	.copy-row {
		display: flex;
		gap: 6px;
		padding: 8px;
		border-top: 1px solid var(--border);
		margin-top: 4px;
	}
	.copy-input {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		font: inherit;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--accents-7);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		outline: none;
	}
	.copy-btn {
		padding: 0 12px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--geist-background);
		background: var(--geist-foreground);
		border: 1px solid var(--geist-foreground);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.copy-btn:hover {
		opacity: 0.9;
	}

	.board {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	:global(.board > *) {
		flex: 1;
		min-height: 0;
	}

	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
	}
	.empty-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 56px;
		max-width: 420px;
		text-align: center;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--accents-1);
	}
	.empty-card h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.empty-card p {
		margin: 0;
		font-size: 14px;
		color: var(--accents-5);
	}
	.muted {
		color: var(--accents-5);
		font-size: 13px;
	}

</style>
