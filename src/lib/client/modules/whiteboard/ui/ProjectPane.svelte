<script lang="ts">
	import { browser } from '$app/environment';
	import Icon from '$lib/client/components/Icon.svelte';
	import SaveState from '$lib/client/components/SaveState.svelte';
	import Whiteboard from './Whiteboard.svelte';
	import { collab } from '../collab.svelte';
	import { type Project, type Visibility } from '$lib/client/modules/projects';
	import { toasts } from '$lib/client/modules/toasts';
	import { initialFor } from '$lib/client/utils/color';
	import type { AppSupabaseClient } from '../../../../../app';

	type Props = {
		project: Project;
		/** Live multiplayer — only the focused pane holds the realtime channel. */
		live: boolean;
		/** Whether this pane is the focused one (visual highlight). */
		focused: boolean;
		/** Compact header for split view (drops the command-palette button). */
		compact: boolean;
		supabase: AppSupabaseClient | null;
		userId: string | null;
		userEmail: string | null;
		onFocus: () => void;
		/** Enter split view (single-pane mode only). */
		onToggleSplit?: () => void;
		/** Close this pane (split mode only). */
		onClose?: () => void;
		/** Persist a scene update for this project. Debouncing is the caller's job. */
		onSceneChange: (scene: string) => void;
		/** Rename this project. */
		onRename: (name: string) => void;
		/** Change this project's visibility. Public links carry an expiry. */
		onSetVisibility: (v: Visibility, linkExpiresAt?: number) => void;
		/** Save-in-flight indicator (drives the header pill). */
		saving: boolean;
	};

	let {
		project,
		live,
		focused,
		compact,
		supabase,
		userId,
		userEmail,
		onFocus,
		onToggleSplit,
		onClose,
		onSceneChange,
		onRename,
		onSetVisibility,
		saving
	}: Props = $props();

	function handleChange(scene: string) {
		onSceneChange(scene);
	}

	function relative(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) {
			return 'just now';
		}
		const m = Math.floor(diff / 60000);
		if (m < 60) {
			return `${m}m ago`;
		}
		const h = Math.floor(m / 60);
		if (h < 24) {
			return `${h}h ago`;
		}
		return `${Math.floor(h / 24)}d ago`;
	}

	// Inline title edit.
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
		if (!next || next === project.name) {
			return;
		}
		onRename(next);
	}
	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitTitleEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			titleEditing = false;
		}
	}

	// Share menu.
	let shareOpen = $state(false);
	let copied = $state(false);

	const publicUrl = $derived(
		typeof window === 'undefined' ? '' : `${window.location.origin}/p/${project.id}`
	);

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

	// ---- People shares (the primary way to share) ----
	type Share = { id: string; email: string; role: string; createdAt: string };
	let shares = $state<Share[]>([]);
	let inviteEmail = $state('');
	let inviteBusy = $state(false);
	// Which project the `shares` list belongs to — the pane survives project
	// switches, so opening the menu re-fetches when the project changed.
	let sharesProjectId: string | null = null;

	async function loadShares() {
		const forProject = project.id;
		try {
			const res = await fetch(`/api/projects/${forProject}/shares`);
			if (!res.ok) {
				return;
			}
			const data: { shares: Share[] } = await res.json();
			if (project.id === forProject) {
				shares = data.shares;
				sharesProjectId = forProject;
			}
		} catch {
			// Non-fatal — the menu just shows an empty people list.
		}
	}

	async function errorMessage(res: Response): Promise<string> {
		const body: { message?: string } | null = await res.json().catch(() => null);
		return body?.message ?? `HTTP ${res.status}`;
	}

	async function addShare() {
		const email = inviteEmail.trim().toLowerCase();
		if (!email || !email.includes('@')) {
			toasts.error('Enter a valid email');
			return;
		}
		inviteBusy = true;
		try {
			const res = await fetch(`/api/projects/${project.id}/shares`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email })
			});
			if (!res.ok) {
				toasts.error('Could not share', { description: await errorMessage(res) });
				return;
			}
			const data: { share: Share } = await res.json();
			if (!shares.some((s) => s.id === data.share.id)) {
				shares = [...shares, data.share];
			}
			inviteEmail = '';
			toasts.success('Shared', { description: `${data.share.email} can now view this project.` });
		} finally {
			inviteBusy = false;
		}
	}

	async function removeShare(share: Share) {
		const previous = shares;
		shares = shares.filter((s) => s.id !== share.id);
		const res = await fetch(`/api/projects/${project.id}/shares/${share.id}`, {
			method: 'DELETE'
		});
		if (!res.ok) {
			shares = previous;
			toasts.error('Could not remove', { description: await errorMessage(res) });
			return;
		}
		toasts.info(`Removed ${share.email}`);
	}

	function toggleShareMenu() {
		shareOpen = !shareOpen;
		if (shareOpen && sharesProjectId !== project.id) {
			shares = [];
			loadShares();
		}
	}

	// Eager-load once so the trigger label reflects existing shares.
	if (browser) {
		loadShares();
	}

	// ---- Public link (always constrained by an expiry) ----
	const EXPIRY_PRESETS = [
		{ label: '1 day', ms: 24 * 60 * 60 * 1000 },
		{ label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
		{ label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 }
	];
	let expiryMs = $state(EXPIRY_PRESETS[1].ms);

	const linkExpired = $derived(
		project.visibility === 'link' &&
			project.linkExpiresAt !== null &&
			project.linkExpiresAt <= Date.now()
	);
	const linkActive = $derived(project.visibility === 'link' && !linkExpired);

	function expiryLabel(ts: number): string {
		const diff = ts - Date.now();
		if (diff <= 0) {
			return 'expired';
		}
		const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
		return days === 1 ? 'in 1 day' : `in ${days} days`;
	}

	function enableLink() {
		onSetVisibility('link', Date.now() + expiryMs);
		toasts.info('Public link enabled', {
			description: `Anyone with the link can view ${EXPIRY_PRESETS.find((p) => p.ms === expiryMs)?.label ?? ''}.`
		});
	}

	function disableLink() {
		onSetVisibility('private');
		toasts.info('Public link disabled');
	}

	function changeExpiry(ms: number) {
		expiryMs = ms;
		if (project.visibility === 'link') {
			onSetVisibility('link', Date.now() + ms);
		}
	}

	const shareTriggerLabel = $derived.by(() => {
		if (linkActive) {
			return 'Anyone with link';
		}
		if (shares.length > 0) {
			return `Shared · ${shares.length}`;
		}
		return 'Private';
	});

	function closeShareOnOutside(e: MouseEvent) {
		const t = e.target;
		if (!(t instanceof Element)) {
			return;
		}
		if (!t.closest('.share-wrap')) {
			shareOpen = false;
		}
	}

	// Peers belong to whichever project the channel is on — only show them on
	// the live pane.
	const peers = $derived(live ? collab.peers : []);
</script>

<svelte:window onmousedown={closeShareOnOutside} />

<section class="pane" class:focused class:split={compact} onpointerdowncapture={() => onFocus()}>
	<header class="masthead">
		<div class="masthead-lead">
			<div class="title-row">
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
							{project.name}
						</button>
					</h1>
				{/if}
				<span class="meta">Updated {relative(project.updatedAt)}</span>
			</div>
		</div>
		<div class="topbar-right">
			{#if peers.length > 0}
				<div class="presence-stack" aria-label="People viewing this project">
					{#each peers.slice(0, 5) as peer (peer.id)}
						<span
							class="presence-avatar"
							title={peer.email}
							style="--from: {peer.color.from}; --to: {peer.color.to};"
						>
							{initialFor(peer.name)}
						</span>
					{/each}
					{#if peers.length > 5}
						<span class="presence-more" title="and more">+{peers.length - 5}</span>
					{/if}
				</div>
				<span class="masthead-rule" aria-hidden="true"></span>
			{/if}
			<div class="share-wrap">
				<button
					class="share-trigger"
					class:public={linkActive}
					onclick={toggleShareMenu}
					title="Sharing"
				>
					<Icon
						name={linkActive ? 'link' : shares.length > 0 ? 'mail' : 'lock'}
						size={12}
						class="share-trigger-icon"
					/>
					<span>{shareTriggerLabel}</span>
				</button>
				{#if shareOpen}
					<div class="share-menu" role="dialog" aria-label="Sharing">
						<div class="menu-section-label">Share with people</div>
						<form
							class="invite-row"
							onsubmit={(e) => {
								e.preventDefault();
								addShare();
							}}
						>
							<input
								class="invite-input"
								type="email"
								placeholder="name@example.com"
								bind:value={inviteEmail}
								disabled={inviteBusy}
							/>
							<button class="copy-btn" type="submit" disabled={inviteBusy || !inviteEmail.trim()}>
								{inviteBusy ? 'Adding…' : 'Add'}
							</button>
						</form>
						{#if shares.length > 0}
							<ul class="share-list">
								{#each shares as share (share.id)}
									<li class="share-person">
										<span class="share-avatar">{initialFor(share.email)}</span>
										<span class="share-email" title={share.email}>{share.email}</span>
										<span class="share-role">Can view</span>
										<button
											class="share-remove"
											title="Remove access"
											aria-label={`Remove ${share.email}`}
											onclick={() => removeShare(share)}
										>
											<Icon name="x" size={12} />
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="share-hint">
								Only people you add can view this project. They open it at the project link after
								signing in.
							</p>
						{/if}

						<div class="menu-divider"></div>

						<div class="menu-section-label">Public link</div>
						{#if linkActive}
							<div class="link-status">
								<span class="link-status-text">
									Anyone with the link can view · {project.linkExpiresAt
										? `expires ${expiryLabel(project.linkExpiresAt)}`
										: 'no expiry'}
								</span>
								<button class="link-off-btn" onclick={disableLink}>Turn off</button>
							</div>
							<div class="copy-row">
								<input class="copy-input" readonly value={publicUrl} />
								<button class="copy-btn" onclick={copyShareUrl}>
									{copied ? 'Copied' : 'Copy'}
								</button>
							</div>
						{:else}
							{#if linkExpired}
								<p class="share-hint expired">The previous public link has expired.</p>
							{/if}
							<div class="link-enable-row">
								<span class="link-enable-label">View-only, expires after</span>
								<div class="expiry-presets" role="radiogroup" aria-label="Link expiry">
									{#each EXPIRY_PRESETS as preset (preset.ms)}
										<button
											class="expiry-chip"
											class:active={expiryMs === preset.ms}
											onclick={() => changeExpiry(preset.ms)}
										>
											{preset.label}
										</button>
									{/each}
								</div>
							</div>
							<button class="link-on-btn" onclick={enableLink}>Enable public link</button>
						{/if}
					</div>
				{/if}
			</div>
			<SaveState {saving} />
			{#if compact}
				<button
					class="pane-btn"
					title="Close this pane"
					aria-label="Close pane"
					onclick={() => onClose?.()}
				>
					<Icon name="x" size={14} />
				</button>
			{:else}
				<button
					class="pane-btn"
					title="Split view — open a second project"
					aria-label="Split view"
					onclick={() => onToggleSplit?.()}
				>
					<Icon name="sidebar" size={14} />
				</button>
			{/if}
		</div>
	</header>

	<div class="board" class:compact>
		<div class="canvas-frame">
			{#key project.id}
				<Whiteboard
					scene={project.scene}
					onChange={handleChange}
					{supabase}
					{live}
					projectId={project.id}
					{userId}
					{userEmail}
				/>
			{/key}
		</div>
	</div>
</section>

<style>
	.pane {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		/* The pane is the "mat" the canvas is mounted on — page paper, not surface. */
		background: var(--bg);
		position: relative;
	}
	.pane.split:not(.focused) .masthead {
		opacity: 0.7;
	}

	/* ---- Editorial masthead (the "wall label") ---- */
	.masthead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--border);
		background: var(--bg);
		min-height: 54px;
	}
	.masthead-lead {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1 1 auto;
	}
	.title-row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	/* display: contents makes the <button> itself the flex child of
	   .title-row, so the standard flex + min-width:0 + ellipsis pattern works. */
	.project-title {
		display: contents;
	}
	.project-title-btn {
		font: inherit;
		font-size: 15px;
		font-weight: 650;
		line-height: 1.2;
		letter-spacing: -0.01em;
		color: var(--fg);
		background: transparent;
		border: none;
		padding: 1px 6px;
		margin: -1px -6px;
		border-radius: var(--radius-xs);
		cursor: text;
		text-align: left;
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: background 120ms;
	}
	.project-title-btn:hover {
		background: var(--accent-soft);
	}
	.project-title-btn:focus-visible {
		outline: 2px solid var(--accent, var(--fg));
		outline-offset: 1px;
	}
	.project-title-input {
		margin: -1px -6px;
		padding: 1px 6px;
		font: inherit;
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.01em;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border-strong, var(--border));
		border-radius: var(--radius-xs);
		outline: none;
		min-width: 0;
		max-width: 360px;
		caret-color: var(--accent, var(--sage));
	}
	.project-title-input:focus {
		border-color: var(--accent, var(--fg));
		background: var(--surface);
	}
	.meta {
		font-size: 11px;
		color: var(--muted);
		flex: 0 0 auto;
		white-space: nowrap;
	}

	.presence-stack {
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
	}
	.presence-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		font-size: 10px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.96);
		background: linear-gradient(135deg, var(--from), var(--to));
		border: 2px solid var(--bg);
		border-radius: 50%;
		margin-left: -7px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
	}
	.presence-avatar:first-child {
		margin-left: 0;
	}
	.presence-more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		padding: 0 6px;
		margin-left: -7px;
		font-size: 10px;
		font-weight: 600;
		color: var(--fg-2);
		background: var(--surface-2);
		border: 2px solid var(--bg);
		border-radius: 12px;
	}
	/* Hairline rule separating presence from the action cluster. */
	.masthead-rule {
		width: 1px;
		height: 22px;
		background: var(--border);
		margin: 0 2px;
		flex: 0 0 auto;
	}

	.topbar-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
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
		color: var(--fg-2);
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
		color: var(--fg);
		border-color: var(--soft);
	}
	.share-trigger.public {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		background: var(--accent-soft);
	}
	:global(.share-trigger-icon) {
		opacity: 0.85;
	}

	.pane-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		color: var(--muted);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 7px;
		cursor: pointer;
		transition:
			color 120ms,
			border-color 120ms,
			background 120ms;
	}
	.pane-btn:hover {
		color: var(--fg);
		border-color: var(--soft);
		background: var(--surface);
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
		box-shadow: var(--shadow-md);
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
		color: var(--muted);
	}
	.menu-divider {
		height: 1px;
		margin: 6px 2px;
		background: var(--border);
	}

	/* ---- people shares ---- */
	.invite-row {
		display: flex;
		gap: 6px;
		padding: 2px 8px 6px;
	}
	.invite-input {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		font: inherit;
		font-size: 12px;
		color: var(--fg);
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		outline: none;
	}
	.invite-input:focus {
		border-color: var(--accent, var(--fg));
		background: var(--surface);
	}
	.share-list {
		list-style: none;
		margin: 0;
		padding: 0 4px 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 180px;
		overflow-y: auto;
	}
	.share-person {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px;
		border-radius: var(--radius-sm);
	}
	.share-person:hover {
		background: var(--bg-2);
	}
	.share-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex: 0 0 auto;
		font-size: 9px;
		font-weight: 600;
		color: var(--fg-2);
		background: var(--border);
		border-radius: 50%;
	}
	.share-email {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.share-role {
		flex: 0 0 auto;
		font-size: 10px;
		color: var(--muted);
	}
	.share-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex: 0 0 auto;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: var(--radius-xs);
		cursor: pointer;
	}
	.share-remove:hover {
		color: var(--fg);
		background: var(--border);
	}
	.share-hint {
		margin: 0;
		padding: 2px 10px 8px;
		font-size: 11px;
		line-height: 1.5;
		color: var(--muted);
	}
	.share-hint.expired {
		color: var(--saffron, var(--fg-2));
	}

	/* ---- public link ---- */
	.link-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 10px;
	}
	.link-status-text {
		flex: 1;
		font-size: 11px;
		line-height: 1.5;
		color: var(--fg-2);
	}
	.link-off-btn {
		flex: 0 0 auto;
		padding: 3px 8px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--fg-2);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.link-off-btn:hover {
		color: var(--fg);
		border-color: var(--soft);
	}
	.link-enable-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 2px 10px 6px;
	}
	.link-enable-label {
		font-size: 11px;
		color: var(--muted);
	}
	.expiry-presets {
		display: flex;
		gap: 4px;
	}
	.expiry-chip {
		padding: 3px 9px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--fg-2);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		cursor: pointer;
	}
	.expiry-chip:hover {
		border-color: var(--soft);
	}
	.expiry-chip.active {
		color: var(--accent, var(--fg));
		border-color: color-mix(in srgb, var(--accent, var(--fg)) 45%, transparent);
		background: var(--accent-soft, var(--bg-2));
	}
	.link-on-btn {
		margin: 0 8px 6px;
		padding: 6px 10px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--bg);
		background: var(--fg);
		border: 1px solid var(--fg);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.link-on-btn:hover {
		opacity: 0.9;
	}
	.copy-row {
		display: flex;
		gap: 6px;
		padding: 6px 8px 4px;
	}
	.copy-input {
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		font: inherit;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--fg);
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		outline: none;
	}
	.copy-btn {
		padding: 0 12px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--bg);
		background: var(--fg);
		border: 1px solid var(--fg);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.copy-btn:hover {
		opacity: 0.9;
	}

	/* ---- Canvas stage ---- */
	.board {
		flex: 1;
		min-height: 0;
		display: flex;
		/* Single pane: the canvas runs edge-to-edge, flush with the sidebar and
		   masthead — no matting gap. */
		padding: 0;
	}
	/* Split view keeps the matting so the two boards read as separate prints. */
	.board.compact {
		padding: 10px 12px 12px;
	}
	.canvas-frame {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		overflow: hidden;
		background: var(--surface);
	}
	.board.compact .canvas-frame {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}
	.canvas-frame :global(> *) {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	/* The split-focused accent rail belongs on the framed canvas now, not the
	   whole pane, so it reads as "this print is active". */
	.pane.split.focused .canvas-frame {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
		box-shadow:
			var(--shadow-md),
			0 0 0 1px var(--accent-soft);
	}
</style>
