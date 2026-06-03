<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { Button } from '@juspay/svelte-ui-components';
	import { Sidebar } from '$lib/client/modules/sidebar';
	import { ProjectPane } from '$lib/client/modules/whiteboard';
	import { projects } from '$lib/client/modules/projects';
	import { workspaces } from '$lib/client/modules/workspaces';
	import { splitView, SplitPane, PanePicker } from '$lib/client/modules/split-view';
	import { CommandPalette } from '$lib/client/modules/command-palette';
	import { WhatsNewModal, whatsNew } from '$lib/client/modules/whats-new';
	import { DocProjectView, documents } from '$lib/client/modules/documents';
	import { toasts } from '$lib/client/modules/toasts';

	let { data } = $props();
	const { supabase, user, isAdmin } = $derived(data);

	// Becomes true once initial state is wired up, gating the URL-sync effect so
	// it doesn't clobber the address bar before the stores have hydrated.
	let bootstrapped = $state(false);

	onMount(() => {
		// Surface store failures as toasts. The stores push to these listeners
		// the moment something fails — no $effect polling `error` each tick.
		const showError = (description: string) => {
			toasts.error('Something went wrong', { description });
		};
		projects.onError(showError);
		workspaces.onError(showError);

		// Apply any deep-link from the URL (?p=<project>&d=<document>) before the
		// stores load, so a reload reopens the same project/document instead of
		// snapping back to the first one. These are one-shot preferences the
		// stores consume on their next load.
		const params = new URL(window.location.href).searchParams;
		const routeProject = params.get('p');
		const routeDoc = params.get('d');
		if (routeProject) {
			projects.setInitialProject(routeProject);
			if (routeDoc) {
				documents.setInitialDoc(routeProject, routeDoc);
			}
		}

		workspaces.onActiveChange((sb, wsId) => {
			projects.loadFor(sb, wsId);
			// Don't close split view on a workspace switch — the right pane runs
			// its own ProjectSession and intentionally holds any workspace's
			// project. The left pane follows the sidebar's active project.
		});
		if (user) {
			workspaces.init(supabase, user.id);
		}
		// Announce any features shipped since this user's last visit.
		whatsNew.check();
		bootstrapped = true;
	});

	// Mirror the active project (and active document, for doc projects) into the
	// URL via replaceState — shareable, reload-safe, and no history-stack spam.
	$effect(() => {
		// Wait until stores have hydrated; otherwise the first run would clear a
		// deep-link from the URL before the active project resolves.
		if (!bootstrapped || workspaces.loading || projects.loading) {
			return;
		}
		const projectId = projects.activeId;
		const isDoc = projects.active?.kind === 'doc';
		const docId = isDoc ? documents.activeId : null;

		const params = new URLSearchParams();
		if (projectId) {
			params.set('p', projectId);
		}
		if (docId) {
			params.set('d', docId);
		}
		const query = params.toString();
		const nextSearch = query ? `?${query}` : '';
		if (nextSearch !== window.location.search) {
			replaceState(nextSearch || window.location.pathname, {});
		}
	});

	// ----- draggable divider -----
	let splitContainerEl: HTMLDivElement | null = $state(null);
	let draggingDivider = $state(false);

	function startDividerDrag(e: PointerEvent) {
		e.preventDefault();
		draggingDivider = true;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		function onMove(ev: PointerEvent) {
			if (!splitContainerEl) {
				return;
			}
			const rect = splitContainerEl.getBoundingClientRect();
			splitView.setRatio((ev.clientX - rect.left) / rect.width);
		}
		function onUp() {
			draggingDivider = false;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

<div class="app">
	<Sidebar userEmail={user?.email ?? ''} userId={user?.id ?? ''} {isAdmin} />

	<main class="main">
		{#if workspaces.loading || projects.loading}
			<div class="empty">
				<p class="muted">Loading…</p>
			</div>
		{:else if projects.active}
			{@const active = projects.active}
			{#if active.kind === 'doc'}
				<DocProjectView projectId={active.id} {supabase} />
			{:else if splitView.enabled}
				<div class="split" bind:this={splitContainerEl}>
					<div class="pane-slot" style="flex: {splitView.ratio};">
						<ProjectPane
							project={active}
							live={splitView.focused === 'left'}
							focused={splitView.focused === 'left'}
							compact
							{supabase}
							userId={user?.id ?? null}
							userEmail={user?.email ?? null}
							onFocus={() => splitView.focus('left')}
							onClose={() => splitView.close()}
							saving={projects.isSaving}
							onSceneChange={(scene) => projects.saveScene(active.id, scene)}
							onRename={(name) => projects.rename(active.id, name)}
							onSetVisibility={(v) => projects.setVisibility(active.id, v)}
						/>
					</div>

					<div
						class="divider"
						class:dragging={draggingDivider}
						role="separator"
						aria-label="Resize panes"
						aria-orientation="vertical"
						tabindex="-1"
						onpointerdown={startDividerDrag}
					>
						<span class="divider-grip"></span>
					</div>

					<div class="pane-slot" style="flex: {1 - splitView.ratio};">
						{#if splitView.rightId}
							{#key splitView.rightId}
								<SplitPane
									projectId={splitView.rightId}
									{supabase}
									userId={user?.id ?? null}
									userEmail={user?.email ?? null}
									live={splitView.focused === 'right'}
									focused={splitView.focused === 'right'}
									onFocus={() => splitView.focus('right')}
									onClose={() => splitView.close()}
								/>
							{/key}
						{:else}
							<PanePicker
								{supabase}
								focused={splitView.focused === 'right'}
								onFocus={() => splitView.focus('right')}
								onClose={() => splitView.close()}
								onpick={(id) => splitView.setRight(id)}
							/>
						{/if}
					</div>
				</div>
			{:else}
				<ProjectPane
					project={active}
					live
					focused={false}
					compact={false}
					{supabase}
					userId={user?.id ?? null}
					userEmail={user?.email ?? null}
					onFocus={() => {}}
					onToggleSplit={() => splitView.enable()}
					saving={projects.isSaving}
					onSceneChange={(scene) => projects.saveScene(active.id, scene)}
					onRename={(name) => projects.rename(active.id, name)}
					onSetVisibility={(v) => projects.setVisibility(active.id, v)}
				/>
			{/if}
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
<WhatsNewModal />

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

	/* ----- split layout ----- */
	.split {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: stretch;
	}
	.pane-slot {
		min-width: 0;
		min-height: 0;
		display: flex;
		overflow: hidden;
	}
	.pane-slot :global(> *) {
		flex: 1;
		min-width: 0;
	}

	.divider {
		flex: 0 0 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--border);
		cursor: col-resize;
		position: relative;
		transition: background 120ms;
	}
	.divider:hover,
	.divider.dragging {
		background: var(--accent, var(--geist-success));
	}
	.divider-grip {
		width: 2px;
		height: 28px;
		border-radius: 2px;
		background: var(--accents-4);
	}
	.divider:hover .divider-grip,
	.divider.dragging .divider-grip {
		background: rgba(255, 255, 255, 0.8);
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
