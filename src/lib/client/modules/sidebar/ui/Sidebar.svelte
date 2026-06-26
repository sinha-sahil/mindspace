<script lang="ts">
	import { ContextMenu, Modal, Button, Tooltip } from '@juspay/svelte-ui-components';
	import Logo from '$lib/client/components/Logo.svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import WorkspaceSettingsModal from './WorkspaceSettingsModal.svelte';
	import McpInstallModal from '$lib/client/modules/mcp/ui/McpInstallModal.svelte';
	import { projects, type Project, type ProjectKind } from '$lib/client/modules/projects';
	import { workspaces, type Workspace } from '$lib/client/modules/workspaces';
	import { theme, type ThemeMode, type ThemeSkin, SKINS } from '$lib/client/modules/theme';
	import { sidebar } from '$lib/client/modules/sidebar';
	import { splitView } from '$lib/client/modules/split-view';
	import { commandPalette } from '$lib/client/modules/command-palette';
	import { whatsNew } from '$lib/client/modules/whats-new';
	import { toasts } from '$lib/client/modules/toasts';
	import { analytics } from '$lib/client/modules/analytics';
	import { colorForKey, initialFor } from '$lib/client/utils/color';

	type Props = {
		userEmail: string;
		userId: string;
		isAdmin: boolean;
	};
	let { userEmail, userId, isAdmin }: Props = $props();

	let editingId = $state<string | null>(null);
	let draftName = $state('');
	let renameInputEl: HTMLInputElement | null = $state(null);

	let wsMenuOpen = $state(false);
	let userMenuOpen = $state(false);
	let newProjectMenuOpen = $state(false);
	let mcpInstallOpen = $state(false);
	let refreshingProjects = $state(false);

	async function refreshProjects() {
		if (refreshingProjects) {
			return;
		}
		refreshingProjects = true;
		try {
			await projects.refresh();
		} catch (e) {
			toasts.error('Could not refresh projects', {
				description: e instanceof Error ? e.message : 'Unknown error'
			});
		} finally {
			refreshingProjects = false;
		}
	}

	let createWsOpen = $state(false);
	let newWsName = $state('');
	let newWsBusy = $state(false);
	let newWsError = $state('');

	// Workspace inline-rename + settings modal state.
	let wsEditingId = $state<string | null>(null);
	let wsEditingDraft = $state('');
	let wsRenameInputEl: HTMLInputElement | null = $state(null);
	let settingsWorkspace = $state<Workspace | null>(null);

	function startWsRename(ws: Workspace) {
		if (ws.ownerId !== userId) {
			toasts.error('Only the workspace owner can rename it');
			return;
		}
		wsEditingId = ws.id;
		wsEditingDraft = ws.name;
		queueMicrotask(() => wsRenameInputEl?.select());
	}
	async function commitWsRename() {
		if (!wsEditingId) {
			return;
		}
		const id = wsEditingId;
		const next = wsEditingDraft.trim();
		wsEditingId = null;
		const ws = workspaces.items.find((w) => w.id === id);
		if (!next || !ws || next === ws.name) {
			return;
		}
		try {
			await workspaces.rename(id, next);
			toasts.success('Workspace renamed', { description: next });
		} catch (e) {
			toasts.error('Could not rename', {
				description: e instanceof Error ? e.message : ''
			});
		}
	}
	function handleWsRenameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitWsRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			wsEditingId = null;
		}
	}

	function workspaceMenuItems(ws: Workspace) {
		const isOwner = ws.ownerId === userId;
		return [
			{ label: 'Rename', value: 'rename', disabled: !isOwner },
			{ label: 'Manage members…', value: 'manage' },
			...(isOwner
				? [
						{ label: '', value: 'sep', separator: true },
						{ label: 'Delete workspace', value: 'delete', danger: true }
					]
				: [])
		];
	}

	async function handleWorkspaceMenu(value: string, ws: Workspace) {
		if (value === 'rename') {
			startWsRename(ws);
		} else if (value === 'manage') {
			settingsWorkspace = ws;
			wsMenuOpen = false;
		} else if (value === 'delete') {
			if (workspaces.items.length <= 1) {
				toasts.error("You can't delete your only workspace.");
				return;
			}
			if (!confirm(`Delete "${ws.name}" and all its projects? This can't be undone.`)) {
				return;
			}
			await workspaces.remove(ws.id);
			toasts.info('Workspace deleted', { description: ws.name });
			wsMenuOpen = false;
		}
	}

	// Drag-to-reorder state. dropIndex is the position in the visible list where
	// the dragged item will land if dropped now (0 = top).
	let listEl: HTMLElement | null = $state(null);
	let draggingId = $state<string | null>(null);
	let dropIndex = $state<number | null>(null);
	let suppressNextClick = false;
	const DRAG_THRESHOLD_PX = 5;

	function focusOnTrigger(node: HTMLInputElement, trigger: boolean) {
		if (trigger) {
			queueMicrotask(() => node.focus());
		}
		return {
			update(next: boolean) {
				if (next) {
					queueMicrotask(() => node.focus());
				}
			}
		};
	}

	// Body-portaled hover tooltip for rail items inside .list — escapes the
	// list's overflow clip that the CSS-only [data-tip]::after can't.
	function railTip(node: HTMLElement, label: string | null) {
		let text = label;
		let el: HTMLDivElement | null = null;

		function show() {
			if (!text || el || typeof document === 'undefined') {
				return;
			}
			const rect = node.getBoundingClientRect();
			el = document.createElement('div');
			el.className = 'rail-tip-portal';
			el.textContent = text;
			el.style.cssText = `position:fixed;left:${rect.right + 12}px;top:${rect.top + rect.height / 2}px;transform:translateY(-50%) translateX(-4px);opacity:0;`;
			document.body.appendChild(el);
			// next frame so the transition runs
			requestAnimationFrame(() => {
				if (!el) {
					return;
				}
				el.style.opacity = '1';
				el.style.transform = 'translateY(-50%) translateX(0)';
			});
		}
		function hide() {
			el?.remove();
			el = null;
		}

		node.addEventListener('mouseenter', show);
		node.addEventListener('mouseleave', hide);
		node.addEventListener('mousedown', hide);

		return {
			update(next: string | null) {
				text = next;
				if (el && text) {
					el.textContent = text;
				} else if (!text) {
					hide();
				}
			},
			destroy() {
				hide();
				node.removeEventListener('mouseenter', show);
				node.removeEventListener('mouseleave', hide);
				node.removeEventListener('mousedown', hide);
			}
		};
	}

	function startRename(id: string, current: string) {
		editingId = id;
		draftName = current;
		queueMicrotask(() => renameInputEl?.select());
	}

	function beginDrag(e: PointerEvent, projectId: string, rowEl: HTMLElement) {
		// Only respond to primary button. Secondary/middle leave the row alone
		// so the ContextMenu and other handlers behave normally.
		if (e.button !== 0) {
			return;
		}
		// Don't initiate drag while editing a name (input has focus).
		if (editingId === projectId) {
			return;
		}
		const closestItem = rowEl.closest('.item');
		if (!(closestItem instanceof HTMLElement)) {
			return;
		}
		const sourceEl: HTMLElement = closestItem;

		const startX = e.clientX;
		const startY = e.clientY;
		let dragging = false;
		let ghost: HTMLElement | null = null;
		let ghostOffsetX = 0;
		let ghostOffsetY = 0;

		function computeDropIndex(clientY: number): number {
			if (!listEl) {
				return 0;
			}
			const items = Array.from(listEl.querySelectorAll<HTMLElement>('.item:not(.dragging)'));
			for (let i = 0; i < items.length; i++) {
				const r = items[i].getBoundingClientRect();
				const mid = r.top + r.height / 2;
				if (clientY < mid) {
					return i;
				}
			}
			return items.length;
		}

		function startActualDrag(clientX: number, clientY: number) {
			dragging = true;
			draggingId = projectId;

			const r = sourceEl.getBoundingClientRect();
			ghostOffsetX = clientX - r.left;
			ghostOffsetY = clientY - r.top;

			// Clone the source row as a floating ghost positioned at the cursor.
			const clone = sourceEl.cloneNode(true);
			if (!(clone instanceof HTMLElement)) {
				return;
			}
			ghost = clone;
			ghost.classList.add('drag-ghost');
			ghost.style.position = 'fixed';
			ghost.style.left = `${clientX - ghostOffsetX}px`;
			ghost.style.top = `${clientY - ghostOffsetY}px`;
			ghost.style.width = `${r.width}px`;
			ghost.style.height = `${r.height}px`;
			ghost.style.pointerEvents = 'none';
			ghost.style.zIndex = '9999';
			document.body.appendChild(ghost);

			// Lock the user's cursor and prevent text selection across the page.
			document.body.style.cursor = 'grabbing';
			document.body.style.userSelect = 'none';
		}

		function onMove(ev: PointerEvent) {
			if (!dragging) {
				const dx = ev.clientX - startX;
				const dy = ev.clientY - startY;
				if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
					return;
				}
				startActualDrag(ev.clientX, ev.clientY);
			}
			if (ghost) {
				ghost.style.left = `${ev.clientX - ghostOffsetX}px`;
				ghost.style.top = `${ev.clientY - ghostOffsetY}px`;
			}
			dropIndex = computeDropIndex(ev.clientY);
		}

		function teardownGhost() {
			ghost?.remove();
			ghost = null;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		}

		function onUp() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);

			if (dragging && dropIndex !== null) {
				const currentIndex = projects.projects.findIndex((p) => p.id === projectId);
				// dropIndex was computed from the list with the dragging item
				// excluded, so it's already the final target — no shift needed.
				if (dropIndex !== currentIndex && dropIndex >= 0) {
					projects.reorder(projectId, dropIndex);
				}
				// Swallow the synthetic click that fires immediately after
				// pointerup so we don't re-select the item we just dropped.
				suppressNextClick = true;
				queueMicrotask(() => {
					setTimeout(() => {
						suppressNextClick = false;
					}, 0);
				});
			}
			teardownGhost();
			draggingId = null;
			dropIndex = null;
		}

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	function consumeClickIfDragged(): boolean {
		if (suppressNextClick) {
			suppressNextClick = false;
			return true;
		}
		return false;
	}
	function commitRename() {
		if (editingId) {
			projects.rename(editingId, draftName);
		}
		editingId = null;
	}
	function handleRenameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			commitRename();
		} else if (e.key === 'Escape') {
			editingId = null;
		}
	}

	function relativeTime(ts: number): string {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		if (m < 1) {
			return 'just now';
		}
		if (m < 60) {
			return `${m}m ago`;
		}
		const h = Math.floor(m / 60);
		if (h < 24) {
			return `${h}h ago`;
		}
		const d = Math.floor(h / 24);
		return `${d}d ago`;
	}

	async function submitNewWorkspace(e?: SubmitEvent) {
		e?.preventDefault();
		if (!newWsName.trim()) {
			return;
		}
		newWsBusy = true;
		newWsError = '';
		const ws = await workspaces.add(newWsName);
		newWsBusy = false;
		if (ws) {
			createWsOpen = false;
			newWsName = '';
			toasts.success('Workspace created', { description: ws.name });
		} else if (workspaces.error) {
			newWsError = workspaces.error;
		}
	}

	function closeCreateWs() {
		createWsOpen = false;
		newWsName = '';
		newWsError = '';
	}

	async function handleNewProject() {
		const created = await projects.add();
		if (created) {
			toasts.success('Project created', { description: created.name });
		}
	}

	async function createProjectOfKind(kind: ProjectKind) {
		newProjectMenuOpen = false;
		const created = await projects.add('', kind);
		if (created) {
			const label =
				kind === 'doc'
					? 'Doc project created'
					: kind === 'todo'
						? 'Todo list created'
						: kind === 'sheet'
							? 'Spreadsheet created'
							: 'Project created';
			toasts.success(label, {
				description: created.name
			});
		}
	}

	async function handleDeleteProject(id: string, name: string) {
		await projects.remove(id);
		toasts.info('Project deleted', { description: name });
	}

	/**
	 * Route a project click. When split view is on and the right pane is
	 * focused, the click fills the right pane; otherwise it selects normally
	 * (and clicking the already-active project in expanded mode renames it).
	 */
	function handleProjectClick(project: Project) {
		if (splitView.enabled && splitView.focused === 'right') {
			splitView.setRight(project.id);
			return;
		}
		if (!collapsed && project.id === projects.activeId) {
			startRename(project.id, project.name);
			return;
		}
		projects.select(project.id);
	}

	function projectMenuItems(project: Project) {
		const isPublic = project.visibility === 'link';
		// Only offer "Move to" entries for workspaces other than the active one
		// (since the project already lives there).
		const otherWorkspaces = workspaces.items.filter((ws) => ws.id !== workspaces.activeId);
		const moveItems = otherWorkspaces.map((ws) => ({
			label: `Move to ${ws.name}`,
			value: `move:${ws.id}`
		}));
		return [
			{ label: 'Rename', value: 'rename' },
			{ label: 'Open in split view', value: 'split' },
			{
				label: isPublic ? 'Make private' : 'Share with link',
				value: 'visibility'
			},
			...(isPublic ? [{ label: 'Copy link', value: 'copy-link' }] : []),
			...(moveItems.length > 0
				? [{ label: '', value: 'sep-move', separator: true }, ...moveItems]
				: []),
			{ label: '', value: 'sep-delete', separator: true },
			{ label: 'Delete project', value: 'delete', danger: true }
		];
	}

	async function handleProjectMenu(value: string, project: Project) {
		if (value === 'rename') {
			projects.select(project.id);
			if (sidebar.collapsed) {
				sidebar.toggle();
			}
			queueMicrotask(() => startRename(project.id, project.name));
		} else if (value === 'split') {
			splitView.openInSplit(project.id);
		} else if (value === 'visibility') {
			const next = project.visibility === 'link' ? 'private' : 'link';
			await projects.setVisibility(project.id, next);
			toasts.info(next === 'link' ? 'Project is now public' : 'Project is private');
		} else if (value === 'copy-link') {
			if (typeof window === 'undefined') {
				return;
			}
			const url = `${window.location.origin}/p/${project.id}`;
			try {
				await navigator.clipboard.writeText(url);
				toasts.success('Link copied', { description: url });
				analytics.track('project_link_copied', { project_id: project.id });
			} catch {
				toasts.error('Could not copy', { description: 'Clipboard blocked by the browser.' });
			}
		} else if (value === 'delete') {
			await handleDeleteProject(project.id, project.name);
		} else if (value.startsWith('move:')) {
			const destWorkspaceId = value.slice('move:'.length);
			const destWs = workspaces.items.find((w) => w.id === destWorkspaceId);
			const ok = await projects.moveToWorkspace(project.id, destWorkspaceId);
			if (ok && destWs) {
				toasts.success('Moved project', {
					description: `${project.name} → ${destWs.name}`
				});
			}
		}
	}

	function setTheme(mode: ThemeMode) {
		theme.set(mode);
	}

	function setSkin(skin: ThemeSkin) {
		theme.setSkin(skin);
	}

	const userInitial = $derived((userEmail || '?')[0].toUpperCase());
	const collapsed = $derived(sidebar.collapsed);
	const wsColor = $derived.by(() => {
		const ws = workspaces.active;
		return ws ? colorForKey(ws.id) : { from: '#71717a', to: '#3f3f46', name: 'grey' };
	});
	const userColor = $derived(colorForKey(userEmail || 'user'));

	function closeMenusOnOutside(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof Element)) {
			return;
		}
		if (!target.closest('.ws-trigger') && !target.closest('.ws-menu')) {
			wsMenuOpen = false;
		}
		if (!target.closest('.user-trigger') && !target.closest('.user-menu')) {
			userMenuOpen = false;
		}
		if (!target.closest('.new-project-trigger') && !target.closest('.new-project-menu')) {
			newProjectMenuOpen = false;
		}
	}
</script>

<svelte:window onmousedown={closeMenusOnOutside} />

<aside class="sidebar" class:collapsed>
	<header class="head">
		{#if !collapsed}
			<a href="/" class="brand">
				<Logo size={20} />
				<span class="brand-text">mindspace</span>
			</a>
			<button
				class="icon-btn"
				title="Collapse sidebar"
				aria-label="Collapse sidebar"
				onclick={() => sidebar.toggle()}
			>
				<Icon name="sidebar" size={15} />
			</button>
		{:else}
			<button
				class="rail-brand"
				data-tip="Expand sidebar"
				aria-label="Expand sidebar"
				onclick={() => sidebar.toggle()}
			>
				<Logo size={20} />
			</button>
		{/if}
	</header>

	<div class="ws-row">
		<button
			class="ws-trigger"
			class:rail-tile={collapsed}
			data-tip={collapsed ? (workspaces.active?.name ?? 'Workspace') : null}
			title={!collapsed ? (workspaces.active?.name ?? 'Workspace') : null}
			style="--tile-from: {wsColor.from}; --tile-to: {wsColor.to};"
			onclick={() => (wsMenuOpen = !wsMenuOpen)}
		>
			<span class="ws-avatar" class:rail={collapsed} aria-hidden="true">
				{initialFor(workspaces.active?.name ?? 'W')}
			</span>
			{#if !collapsed}
				<span class="ws-meta">
					<span class="ws-name">{workspaces.active?.name ?? 'Loading…'}</span>
					<span class="ws-sub">
						{workspaces.items.length} workspace{workspaces.items.length === 1 ? '' : 's'}
					</span>
				</span>
				<Icon name="chevron-down" size={13} class="caret" />
			{/if}
		</button>

		{#if wsMenuOpen}
			<div class="popover ws-menu" role="menu">
				<div class="popover-section-label">Switch workspace</div>
				<div class="popover-list">
					{#each workspaces.items as ws (ws.id)}
						{@const isEditingWs = wsEditingId === ws.id}
						<ContextMenu
							items={workspaceMenuItems(ws)}
							onselect={(item) => handleWorkspaceMenu(item.value, ws)}
						>
							<div class="ws-popover-row" class:active={ws.id === workspaces.activeId}>
								<button
									class="ws-popover-item"
									ondblclick={() => startWsRename(ws)}
									onclick={() => {
										if (isEditingWs) {
											return;
										}
										workspaces.select(ws.id);
										wsMenuOpen = false;
									}}
								>
									<span class="ws-avatar small" aria-hidden="true">
										{ws.name[0].toUpperCase()}
									</span>
									{#if isEditingWs}
										<input
											bind:this={wsRenameInputEl}
											class="ws-rename"
											bind:value={wsEditingDraft}
											onkeydown={handleWsRenameKey}
											onblur={commitWsRename}
											onclick={(e) => e.stopPropagation()}
											maxlength="80"
										/>
									{:else}
										<span class="popover-item-text">{ws.name}</span>
									{/if}
									{#if ws.id === workspaces.activeId && !isEditingWs}
										<Icon name="check" size={14} class="popover-check" />
									{/if}
								</button>
								<button
									class="ws-settings-btn"
									title="Workspace settings"
									aria-label="Workspace settings"
									onclick={(e) => {
										e.stopPropagation();
										settingsWorkspace = ws;
										wsMenuOpen = false;
									}}
								>
									<Icon name="settings" size={13} />
								</button>
							</div>
						</ContextMenu>
					{/each}
				</div>
				<div class="popover-divider"></div>
				<button
					class="popover-item"
					onclick={() => {
						wsMenuOpen = false;
						createWsOpen = true;
					}}
				>
					<span class="popover-icon"><Icon name="plus" size={14} /></span>
					<span class="popover-item-text">New workspace</span>
				</button>
			</div>
		{/if}
	</div>

	<div class="actions" class:rail={collapsed}>
		{#if collapsed}
			<button
				class="rail-icon-btn primary"
				data-tip="New project"
				aria-label="New project"
				onclick={handleNewProject}
			>
				<Icon name="plus" size={16} />
			</button>
			<Tooltip text="Refresh projects" position="right">
				<Button
					classes="btn-icon-rail"
					ariaLabel="Refresh projects"
					disabled={refreshingProjects}
					showLoader={refreshingProjects}
					loaderType="Circular"
					onclick={refreshProjects}
				>
					{#snippet icon()}
						{#if !refreshingProjects}<Icon name="refresh" size={15} />{/if}
					{/snippet}
				</Button>
			</Tooltip>
			<button
				class="rail-icon-btn"
				data-tip="Search · ⌘K"
				aria-label="Open command palette"
				onclick={() => commandPalette.setOpen(true)}
			>
				<Icon name="search" size={15} />
			</button>
		{:else}
			<Tooltip text="Refresh projects" position="bottom">
				<Button
					classes="btn-icon"
					ariaLabel="Refresh projects"
					disabled={refreshingProjects}
					showLoader={refreshingProjects}
					loaderType="Circular"
					onclick={refreshProjects}
				>
					{#snippet icon()}
						{#if !refreshingProjects}<Icon name="refresh" size={13} />{/if}
					{/snippet}
				</Button>
			</Tooltip>
			<div class="new-project-wrap">
				<button
					class="action-btn new-project-trigger"
					title="New project"
					aria-haspopup="menu"
					aria-expanded={newProjectMenuOpen}
					onclick={() => (newProjectMenuOpen = !newProjectMenuOpen)}
				>
					<Icon name="plus" size={14} />
					<span>New project</span>
					<Icon name="chevron-down" size={11} class="new-caret" />
				</button>
				{#if newProjectMenuOpen}
					<div class="popover new-project-menu" role="menu">
						<button
							type="button"
							class="popover-item kind-item"
							onclick={() => createProjectOfKind('whiteboard')}
						>
							<span class="popover-icon"><Icon name="folder" size={14} /></span>
							<span class="kind-text">
								<span class="popover-item-text">Whiteboard</span>
								<span class="kind-hint">Infinite canvas for sketches</span>
							</span>
						</button>
						<button
							type="button"
							class="popover-item kind-item"
							onclick={() => createProjectOfKind('doc')}
						>
							<span class="popover-icon"><Icon name="pencil" size={14} /></span>
							<span class="kind-text">
								<span class="popover-item-text">Document</span>
								<span class="kind-hint">Markdown notes with comment threads</span>
							</span>
						</button>
						<button
							type="button"
							class="popover-item kind-item"
							onclick={() => createProjectOfKind('todo')}
						>
							<span class="popover-icon"><Icon name="list" size={14} /></span>
							<span class="kind-text">
								<span class="popover-item-text">Todo list</span>
								<span class="kind-hint">Nested checklists with columns</span>
							</span>
						</button>
						<button
							type="button"
							class="popover-item kind-item"
							onclick={() => createProjectOfKind('sheet')}
						>
							<span class="popover-icon"><Icon name="table" size={14} /></span>
							<span class="kind-text">
								<span class="popover-item-text">Spreadsheet</span>
								<span class="kind-hint">Cells, formulas &amp; functions</span>
							</span>
						</button>
					</div>
				{/if}
			</div>
			<button
				class="cmdk-hint"
				title="Open command palette"
				onclick={() => commandPalette.setOpen(true)}
			>
				<Icon name="search" size={12} />
				<span>Search</span>
				<span class="cmdk-keys">
					<kbd>⌘</kbd><kbd>K</kbd>
				</span>
			</button>
		{/if}
	</div>

	<nav class="list" aria-label="Projects" bind:this={listEl}>
		{#if projects.loading}
			{#if !collapsed}
				<div class="skeleton-list">
					{#each Array(4) as _, i (i)}
						<div class="skeleton-row">
							<div class="skeleton-dot"></div>
							<div class="skeleton-text">
								<div class="skeleton-bar w-{(i % 3) + 1}"></div>
								<div class="skeleton-bar small w-{(i % 2) + 1}"></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			{#each projects.projects as project, projectIdx (project.id)}
				{@const active = project.id === projects.activeId}
				{@const isEditing = editingId === project.id && !collapsed}
				{@const c = colorForKey(project.id)}
				{#if dropIndex === projectIdx && draggingId !== null && draggingId !== project.id}
					<div class="drop-indicator" aria-hidden="true"></div>
				{/if}
				<ContextMenu
					items={projectMenuItems(project)}
					onselect={(item) => handleProjectMenu(item.value, project)}
				>
					<div
						class="item"
						class:active
						class:icon-only={collapsed}
						class:editing={isEditing}
						class:dragging={draggingId === project.id}
						style="--tile-from: {c.from}; --tile-to: {c.to};"
					>
						<button
							class="row"
							class:rail-tile={collapsed}
							use:railTip={collapsed ? project.name : null}
							aria-label={collapsed ? project.name : null}
							title={!collapsed && !active ? project.name : null}
							onpointerdown={(e) => beginDrag(e, project.id, e.currentTarget)}
							onclick={() => {
								if (consumeClickIfDragged()) {
									return;
								}
								handleProjectClick(project);
							}}
						>
							{#if collapsed}
								<span class="rail-letter" aria-hidden="true">
									{initialFor(project.name)}
								</span>
								{#if project.visibility === 'link'}
									<span class="rail-flag" aria-hidden="true">
										<Icon name="link" size={8} strokeWidth={2.5} />
									</span>
								{/if}
							{:else}
								{#if project.kind === 'doc'}
									<span class="kind-icon" aria-hidden="true">
										<Icon name="pencil" size={11} />
									</span>
								{:else if project.kind === 'todo'}
									<span class="kind-icon" aria-hidden="true">
										<Icon name="list" size={11} />
									</span>
								{:else if project.kind === 'sheet'}
									<span class="kind-icon" aria-hidden="true">
										<Icon name="table" size={11} />
									</span>
								{:else}
									<span class="dot" aria-hidden="true"></span>
								{/if}
								<span class="meta">
									{#if isEditing}
										<input
											bind:this={renameInputEl}
											class="rename"
											bind:value={draftName}
											onkeydown={handleRenameKey}
											onblur={commitRename}
											onclick={(e) => e.stopPropagation()}
										/>
									{:else}
										<span class="name">{project.name}</span>
										<span class="time">
											{#if project.visibility === 'link'}
												<span class="link-tag" title="Anyone with link">
													<Icon name="link" size={9} strokeWidth={2.5} />
												</span>
											{/if}
											<span>{relativeTime(project.updatedAt)}</span>
										</span>
									{/if}
								</span>
							{/if}
						</button>
						{#if !collapsed && !isEditing}
							<button
								class="row-trash"
								title="Delete project"
								aria-label="Delete project"
								onclick={(e) => {
									e.stopPropagation();
									handleDeleteProject(project.id, project.name);
								}}
							>
								<Icon name="trash" size={13} />
							</button>
						{/if}
					</div>
				</ContextMenu>
			{:else}
				{#if !collapsed}
					<div class="empty-state">
						<p>No projects yet.</p>
						<p class="hint">Tap "New project" above.</p>
					</div>
				{/if}
			{/each}
			{#if dropIndex !== null && draggingId !== null && dropIndex >= projects.projects.length}
				<div class="drop-indicator" aria-hidden="true"></div>
			{/if}
		{/if}
	</nav>

	<footer class="foot">
		<button
			class="mcp-trigger"
			class:rail-icon-btn={collapsed}
			data-tip={collapsed ? 'Use with Claude Code' : null}
			title={!collapsed ? 'Connect to Claude Code or Claude Desktop' : null}
			aria-label="Connect to Claude Code"
			onclick={() => (mcpInstallOpen = true)}
		>
			<Icon name="command" size={collapsed ? 16 : 13} />
			{#if !collapsed}
				<span class="mcp-label">Use with Claude</span>
			{/if}
		</button>
		<button
			class="user-trigger"
			class:rail-tile={collapsed}
			data-tip={collapsed ? userEmail : null}
			title={!collapsed ? userEmail : null}
			style="--tile-from: {userColor.from}; --tile-to: {userColor.to};"
			onclick={() => (userMenuOpen = !userMenuOpen)}
		>
			<span class="user-avatar" class:rail={collapsed} aria-hidden="true">{userInitial}</span>
			{#if !collapsed}
				<span class="user-meta">
					<span class="user-email">{userEmail}</span>
					<span class="user-role">{isAdmin ? 'Admin' : 'Member'}</span>
				</span>
				<Icon name="chevron-down" size={13} class="caret" />
			{/if}
		</button>

		{#if userMenuOpen}
			<div class="popover user-menu" role="menu">
				<div class="user-card">
					<span class="user-avatar" aria-hidden="true">{userInitial}</span>
					<span class="user-meta">
						<span class="user-email">{userEmail}</span>
						<span class="user-role">{isAdmin ? 'Admin' : 'Member'}</span>
					</span>
				</div>

				<div class="popover-section-label">Theme</div>
				<div class="theme-toggle" role="group" aria-label="Theme">
					<button
						class="theme-pill"
						class:active={theme.mode === 'light'}
						onclick={() => setTheme('light')}
					>
						<Icon name="sun" size={13} />
						<span>Light</span>
					</button>
					<button
						class="theme-pill"
						class:active={theme.mode === 'dark'}
						onclick={() => setTheme('dark')}
					>
						<Icon name="moon" size={13} />
						<span>Dark</span>
					</button>
					<button
						class="theme-pill"
						class:active={theme.mode === 'system'}
						onclick={() => setTheme('system')}
					>
						<Icon name="monitor" size={13} />
						<span>System</span>
					</button>
				</div>

				<div class="popover-section-label">Skin</div>
				<div class="skin-list" role="group" aria-label="Skin">
					{#each SKINS as s (s.id)}
						<button
							class="skin-row"
							class:active={theme.skin === s.id}
							onclick={() => setSkin(s.id)}
							title={s.blurb}
						>
							<span class="skin-swatch" data-skin-preview={s.id} aria-hidden="true"></span>
							<span class="skin-meta">
								<span class="skin-name">{s.label}</span>
								<span class="skin-blurb">{s.blurb}</span>
							</span>
							{#if theme.skin === s.id}
								<Icon name="check" size={13} class="skin-check" />
							{/if}
						</button>
					{/each}
				</div>

				<div class="popover-divider"></div>

				<button
					class="popover-item"
					onclick={() => {
						userMenuOpen = false;
						whatsNew.show();
					}}
				>
					<span class="popover-icon"><Icon name="sparkles" size={14} /></span>
					<span class="popover-item-text">What's new</span>
				</button>
				<a class="popover-item" href="/settings/passkeys" onclick={() => (userMenuOpen = false)}>
					<span class="popover-icon"><Icon name="key" size={14} /></span>
					<span class="popover-item-text">Passkeys</span>
				</a>
				{#if isAdmin}
					<a class="popover-item" href="/admin" onclick={() => (userMenuOpen = false)}>
						<span class="popover-icon"><Icon name="shield" size={14} /></span>
						<span class="popover-item-text">Admin</span>
					</a>
				{/if}

				<div class="popover-divider"></div>

				<form method="POST" action="/auth/logout">
					<button type="submit" class="popover-item danger">
						<span class="popover-icon"><Icon name="logout" size={14} /></span>
						<span class="popover-item-text">Sign out</span>
					</button>
				</form>
			</div>
		{/if}
	</footer>
</aside>

{#if createWsOpen}
	<Modal
		classes="ms-modal"
		size="fit-content"
		header={{ text: 'Create a workspace' }}
		onoverlayClick={closeCreateWs}
	>
		{#snippet content()}
			<form onsubmit={submitNewWorkspace} class="modal-form">
				<p class="modal-intro">Workspaces help you keep separate sets of projects.</p>
				<label class="modal-field">
					<span>Workspace name</span>
					<input
						use:focusOnTrigger={createWsOpen}
						bind:value={newWsName}
						type="text"
						placeholder="e.g. Personal · Acme · Side projects"
						maxlength="80"
					/>
				</label>
				{#if newWsError}
					<p class="modal-error">{newWsError}</p>
				{/if}
			</form>
		{/snippet}
		{#snippet footerSnippet()}
			<Button text="Cancel" classes="btn-secondary" disabled={newWsBusy} onclick={closeCreateWs} />
			<Button
				text={newWsBusy ? 'Creating…' : 'Create workspace'}
				disabled={!newWsName.trim() || newWsBusy}
				onclick={() => submitNewWorkspace()}
			/>
		{/snippet}
	</Modal>
{/if}

<WorkspaceSettingsModal
	workspace={settingsWorkspace}
	isOwner={settingsWorkspace?.ownerId === userId}
	onClose={() => (settingsWorkspace = null)}
/>

<McpInstallModal bind:open={mcpInstallOpen} />

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: 268px;
		border-right: 1px solid var(--border);
		background: var(--accents-1);
		transition: width var(--duration) var(--ease-out);
		flex-shrink: 0;
	}
	.sidebar.collapsed {
		width: 60px;
	}

	/* Theme the @juspay/svelte-ui-components ContextMenu used on project rows.
	   Set globally because the floating menu is portaled outside the trigger. */
	:global(:root) {
		--context-menu-background-color: var(--surface);
		--context-menu-border: 1px solid var(--border);
		--context-menu-border-radius: 8px;
		--context-menu-box-shadow: var(--shadow-medium);
		--context-menu-min-width: 200px;
		--context-menu-padding: 4px;
		--context-menu-font-family: var(--font-sans);
		--context-menu-font-size: 13px;
		--context-menu-item-padding: 7px 10px;
		--context-menu-item-color: var(--geist-foreground);
		--context-menu-item-background-color: transparent;
		--context-menu-item-hover-background-color: var(--accents-1);
		--context-menu-item-focus-background-color: var(--accents-1);
		--context-menu-item-focus-outline: none;
		--context-menu-item-font-weight: 500;
		--context-menu-item-shortcut-color: var(--accents-5);
		--context-menu-separator-color: var(--border);
		--context-menu-separator-margin: 4px 4px;
		--context-menu-item-danger-color: var(--geist-error);
		--context-menu-item-danger-hover-background-color: rgba(238, 0, 0, 0.08);
		--context-menu-item-danger-focus-background-color: rgba(238, 0, 0, 0.08);
	}

	/* =========================================================================
	   ICON RAIL (collapsed) — shared primitives
	   ========================================================================= */
	.sidebar.collapsed .head,
	.sidebar.collapsed .ws-row,
	.sidebar.collapsed .actions,
	.sidebar.collapsed .foot {
		padding: 10px 12px;
	}
	.sidebar.collapsed .ws-row {
		padding-top: 12px;
		padding-bottom: 12px;
	}
	.sidebar.collapsed .list {
		padding: 8px 12px;
		gap: 10px;
		align-items: center;
	}

	.rail-brand {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		margin: 0 auto;
		font: inherit;
		color: var(--fg);
		background: linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%);
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
		position: relative;
		transition:
			transform 140ms var(--ease-spring),
			border-color 140ms;
	}
	.rail-brand:hover {
		transform: translateY(-1px);
		border-color: var(--border-strong);
	}

	.rail-tile {
		position: relative;
		width: 36px !important;
		height: 36px;
		margin: 0 auto;
		padding: 0 !important;
		border-radius: 10px !important;
		background: linear-gradient(135deg, var(--tile-from), var(--tile-to)) !important;
		border: none !important;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.2) inset,
			0 4px 10px -4px color-mix(in srgb, var(--tile-from) 50%, transparent),
			0 0 0 1px color-mix(in srgb, var(--tile-from) 30%, transparent);
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		transition:
			transform 140ms var(--ease-spring),
			box-shadow 200ms;
	}
	.rail-tile:hover {
		transform: translateY(-1px);
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.25) inset,
			0 8px 18px -6px color-mix(in srgb, var(--tile-from) 60%, transparent),
			0 0 0 1px color-mix(in srgb, var(--tile-from) 45%, transparent);
	}
	.rail-letter {
		font-family: var(--font-sans);
		font-size: 14px;
		font-weight: 600;
		line-height: 1;
		color: rgba(255, 255, 255, 0.96);
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
		letter-spacing: -0.01em;
	}
	.rail-flag {
		position: absolute;
		bottom: -3px;
		right: -3px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		color: var(--fg);
		background: var(--bg-2);
		border: 1.5px solid var(--bg);
		border-radius: 50%;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
	}

	.item.active .rail-tile {
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.3) inset,
			0 0 0 2px var(--bg),
			0 0 0 4px color-mix(in srgb, var(--tile-from) 80%, transparent),
			0 8px 22px -4px color-mix(in srgb, var(--tile-from) 70%, transparent);
	}

	.rail-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		font: inherit;
		color: var(--fg-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		position: relative;
		transition:
			transform 140ms var(--ease-spring),
			border-color 140ms,
			color 140ms,
			background 140ms;
	}
	.rail-icon-btn:hover {
		color: var(--fg);
		border-color: var(--border-strong);
		background: var(--surface-2);
		transform: translateY(-1px);
	}
	.rail-icon-btn.primary {
		color: #ffffff;
		background: var(--accent-gradient);
		background-size: 180% 100%;
		background-position: 0% 50%;
		border: none;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.2) inset,
			0 6px 14px -6px var(--accent-glow);
		transition:
			transform 140ms var(--ease-spring),
			background-position 600ms,
			box-shadow 220ms;
	}
	.rail-icon-btn.primary:hover {
		background-position: 100% 50%;
		transform: translateY(-1px);
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.25) inset,
			0 10px 22px -6px var(--accent-glow);
	}

	.actions.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		border-bottom: 1px solid var(--border);
	}

	/* CSS-only tooltip for rail items */
	[data-tip] {
		position: relative;
	}
	[data-tip]::after {
		content: attr(data-tip);
		position: absolute;
		left: calc(100% + 12px);
		top: 50%;
		transform: translateY(-50%) translateX(-4px);
		padding: 5px 9px;
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 500;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		box-shadow: var(--shadow-md);
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 120ms,
			transform 120ms var(--ease-spring);
		z-index: 100;
	}
	[data-tip]:hover::after {
		opacity: 1;
		transform: translateY(-50%) translateX(0);
	}

	/* Body-portaled tooltip (used for project rail items inside .list) */
	:global(.rail-tip-portal) {
		padding: 5px 9px;
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 500;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		box-shadow: var(--shadow-md);
		white-space: nowrap;
		pointer-events: none;
		z-index: 100;
		transition:
			opacity 120ms,
			transform 120ms var(--ease-spring);
	}

	.user-avatar.rail {
		width: 36px;
		height: 36px;
		font-size: 13px;
		background: linear-gradient(135deg, var(--tile-from), var(--tile-to));
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.2) inset,
			0 4px 10px -4px color-mix(in srgb, var(--tile-from) 50%, transparent);
	}

	.ws-avatar.rail {
		width: 36px;
		height: 36px;
		font-size: 14px;
		background: linear-gradient(135deg, var(--tile-from), var(--tile-to));
		color: rgba(255, 255, 255, 0.96);
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.2) inset,
			0 4px 10px -4px color-mix(in srgb, var(--tile-from) 50%, transparent);
	}

	.sidebar.collapsed .item {
		padding: 0;
		background: transparent !important;
		box-shadow: none !important;
	}
	.sidebar.collapsed .item.icon-only .row {
		padding: 0;
	}

	/* Float popovers beside the rail so options stay readable when collapsed */
	.sidebar.collapsed .popover {
		left: calc(100% + 8px);
		right: auto;
		width: min(256px, calc(100vw - 80px));
		padding: 6px;
		animation: popInRight 140ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.sidebar.collapsed .ws-menu {
		top: 6px;
		bottom: auto;
	}
	.sidebar.collapsed .user-menu {
		top: auto;
		bottom: 6px;
	}
	@keyframes popInRight {
		from {
			opacity: 0;
			transform: translateX(-6px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	/* ----- header ----- */
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 12px 12px;
		border-bottom: 1px solid var(--border);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 4px 6px;
		font: inherit;
		text-decoration: none;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		min-width: 0;
	}
	.collapsed-brand {
		justify-content: center;
		padding: 4px;
	}
	.brand:hover {
		background: var(--accents-2);
	}
	.brand-text {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 18px;
		letter-spacing: -0.015em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ----- workspace switcher ----- */
	.ws-row {
		position: relative;
		padding: 10px;
		border-bottom: 1px solid var(--border);
	}
	.ws-trigger {
		width: 100%;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background 120ms;
	}
	.sidebar.collapsed .ws-trigger {
		justify-content: center;
		padding: 4px;
	}
	.ws-trigger:hover {
		background: var(--accents-2);
	}
	.ws-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		font-size: 11px;
		font-weight: 600;
		color: var(--geist-background);
		background: linear-gradient(135deg, var(--geist-foreground), var(--accents-7));
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}
	.ws-avatar.small {
		width: 22px;
		height: 22px;
		font-size: 10px;
	}
	.ws-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.ws-name {
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ws-sub {
		font-size: 11px;
		color: var(--accents-5);
	}
	:global(.caret) {
		color: var(--accents-5);
		flex-shrink: 0;
	}

	/* ----- popovers ----- */
	.popover {
		position: absolute;
		left: 10px;
		right: 10px;
		top: calc(100% - 4px);
		z-index: 50;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-medium);
		display: flex;
		flex-direction: column;
		gap: 2px;
		animation: popIn 120ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.user-menu {
		top: auto;
		bottom: calc(100% - 4px);
	}
	@keyframes popIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.popover-section-label {
		padding: 6px 8px 4px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--accents-5);
	}
	.popover-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		max-height: 240px;
		overflow-y: auto;
	}
	.popover-item {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		text-decoration: none;
		width: 100%;
		box-sizing: border-box;
		transition: background 100ms;
	}
	.popover-item:hover {
		background: var(--accents-1);
	}
	.popover-item.active {
		background: var(--accents-1);
	}
	.popover-item.danger:hover {
		color: var(--geist-error);
	}
	.popover-item-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.popover-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		flex-shrink: 0;
		color: var(--accents-5);
	}
	.popover-item:hover .popover-icon {
		color: var(--geist-foreground);
	}
	:global(.popover-check) {
		color: var(--geist-success);
	}
	.popover-divider {
		height: 1px;
		margin: 4px 4px;
		background: var(--border);
	}

	/* Workspace switcher popover-rows: ws-popover-item is the click-to-switch
	   button; ws-settings-btn appears at the right on hover. */
	.ws-popover-row {
		display: flex;
		align-items: stretch;
		border-radius: var(--radius-sm);
		transition: background 100ms;
	}
	.ws-popover-row:hover {
		background: var(--accents-1);
	}
	.ws-popover-row.active {
		background: var(--accents-1);
	}
	.ws-popover-item {
		flex: 1;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
	}
	.ws-settings-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		flex-shrink: 0;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 120ms,
			color 120ms,
			background 120ms;
	}
	.ws-popover-row:hover .ws-settings-btn,
	.ws-settings-btn:focus-visible {
		opacity: 1;
	}
	.ws-settings-btn:hover {
		color: var(--geist-foreground);
		background: var(--accents-2);
	}
	.ws-rename {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		outline: none;
		caret-color: var(--accent, var(--geist-success));
	}

	/* ----- new project ----- */
	.actions {
		padding: 10px;
		border-bottom: 1px solid var(--border);
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 6px;
	}
	/* In the collapsed rail, stack the icons vertically — the row is too
	   narrow to host them side by side. */
	.actions.rail {
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.action-btn {
		width: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0 12px;
		height: 32px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: var(--geist-background);
		background: var(--geist-foreground);
		border: 1px solid var(--geist-foreground);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			opacity 120ms,
			border-color 120ms,
			background 120ms,
			color 120ms;
	}
	.action-btn:hover {
		opacity: 0.9;
	}
	.sidebar.collapsed .action-btn {
		padding: 0;
	}

	/* The refresh trigger uses the library Button (.btn-icon variant) — its
	   built-in Circular loader handles the spinning state, no custom CSS. */

	.new-project-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	:global(.new-caret) {
		margin-left: auto;
		opacity: 0.7;
	}
	.kind-item {
		gap: 10px;
	}
	.kind-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.kind-hint {
		font-size: 11px;
		color: var(--accents-5);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cmdk-hint {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		padding: 6px 8px;
		font: inherit;
		font-size: 12px;
		color: var(--accents-5);
		background: transparent;
		border: 1px dashed var(--border);
		border-radius: 6px;
		cursor: pointer;
		transition:
			color 120ms,
			border-color 120ms;
	}
	.cmdk-hint:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
	}
	.cmdk-hint span {
		flex: 1;
		text-align: left;
	}
	.cmdk-keys {
		display: inline-flex;
		gap: 2px;
	}
	.cmdk-keys kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 16px;
		padding: 0 4px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accents-6);
		background: var(--accents-2);
		border-radius: 3px;
	}

	/* ----- skeletons ----- */
	.skeleton-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 0;
	}
	.skeleton-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
	}
	.skeleton-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accents-2);
		flex-shrink: 0;
	}
	.skeleton-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.skeleton-bar {
		height: 9px;
		border-radius: 4px;
		background: linear-gradient(
			90deg,
			var(--accents-2) 0%,
			var(--accents-3) 50%,
			var(--accents-2) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	.skeleton-bar.small {
		height: 7px;
		opacity: 0.6;
	}
	.skeleton-bar.w-1 {
		width: 60%;
	}
	.skeleton-bar.w-2 {
		width: 80%;
	}
	.skeleton-bar.w-3 {
		width: 50%;
	}
	@keyframes shimmer {
		0%,
		100% {
			background-position: 200% 0;
		}
		50% {
			background-position: -200% 0;
		}
	}

	/* ----- list ----- */
	.list {
		flex: 1;
		/* x: hidden suppresses the scrollbar that overflow-y: auto would otherwise
		   trigger because of the rail-tile tooltip pseudo-elements. Project-row
		   tooltips are rendered via the railTip action and portaled to <body>, so
		   they aren't clipped by this. */
		overflow: hidden auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.item {
		position: relative;
		display: flex;
		align-items: stretch;
		gap: 0;
		border-radius: var(--radius-md);
		transition: background 120ms;
	}
	.item:hover {
		background: var(--surface);
	}
	.item.active {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
	}
	/* Foil-edge active rule — a lit accent bar down the left edge. */
	.item.active:not(.icon-only)::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 3px;
		height: 56%;
		border-radius: var(--radius-pill);
		background: var(--accent);
		box-shadow: 0 0 10px -1px var(--accent-glow);
		z-index: 1;
	}
	.item.dragging {
		/* Visually remove from the list — the floating ghost takes its place. */
		opacity: 0;
		visibility: hidden;
	}
	.drop-indicator {
		height: 2px;
		margin: -1px 6px;
		background: var(--accent, var(--geist-success));
		border-radius: 2px;
		box-shadow:
			0 0 0 3px color-mix(in srgb, var(--accent, var(--geist-success)) 18%, transparent),
			0 0 12px color-mix(in srgb, var(--accent, var(--geist-success)) 50%, transparent);
		pointer-events: none;
		position: relative;
	}
	.drop-indicator::before {
		content: '';
		position: absolute;
		left: -3px;
		top: -2px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent, var(--geist-success));
	}
	.sidebar.collapsed .drop-indicator {
		margin: -1px 10px;
	}

	/* Floating clone that follows the cursor while dragging. */
	:global(.drag-ghost) {
		box-sizing: border-box;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow:
			0 12px 28px -8px rgba(0, 0, 0, 0.45),
			0 4px 10px -4px rgba(0, 0, 0, 0.3),
			0 0 0 1px color-mix(in srgb, var(--accent, var(--geist-success)) 25%, transparent);
		transform: rotate(-1.2deg) scale(1.02);
		transform-origin: 50% 50%;
		opacity: 0.96;
		transition: transform 80ms ease-out;
		will-change: transform, left, top;
	}
	:global(.drag-ghost .row-trash) {
		display: none;
	}

	/* Cue the row-as-handle: grab hover, grabbing while pressed. */
	.row {
		touch-action: none;
	}
	.item:not(.editing) .row {
		cursor: grab;
	}
	.item.dragging .row {
		cursor: grabbing;
	}
	.row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		text-align: left;
		background: transparent;
		border: none;
		cursor: pointer;
		font: inherit;
		color: var(--geist-foreground);
		border-radius: var(--radius-md);
	}
	.item.editing .row {
		cursor: default;
	}
	.item.icon-only .row {
		justify-content: center;
		padding: 8px 0;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accents-3);
		flex-shrink: 0;
		transition:
			background 120ms,
			box-shadow 120ms;
	}
	.item.active .dot {
		background: var(--geist-success);
		box-shadow: 0 0 0 3px rgba(0, 112, 243, 0.18);
	}
	.kind-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		color: var(--accents-5);
		flex-shrink: 0;
	}
	.item.active .kind-icon {
		color: var(--geist-foreground);
	}
	.meta {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.name {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.time {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--accents-5);
	}
	.link-tag {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		color: var(--geist-success);
		background: rgba(0, 112, 243, 0.12);
		border-radius: 50%;
	}
	.row-trash {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		flex-shrink: 0;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 120ms,
			color 120ms,
			background 120ms;
	}
	.item:hover .row-trash,
	.item.active .row-trash {
		opacity: 1;
	}
	.row-trash:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}
	.empty-state {
		padding: 16px 12px;
		text-align: center;
	}
	.empty-state p {
		margin: 0;
		font-size: 12px;
		color: var(--accents-5);
	}
	.empty-state .hint {
		font-size: 11px;
		color: var(--accents-4);
		margin-top: 2px;
	}

	/* ----- icon buttons ----- */
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		font: inherit;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 100ms;
	}
	.icon-btn.small {
		width: 22px;
		height: 22px;
	}
	.icon-btn:hover {
		color: var(--geist-foreground);
		background: var(--accents-2);
	}
	.icon-btn.danger:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}

	.rename {
		width: 100%;
		min-width: 0;
		margin: 0;
		padding: 0;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		outline: none;
		caret-color: var(--geist-success);
	}

	/* ----- footer / user profile ----- */
	.foot {
		position: relative;
		padding: 10px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mcp-trigger {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-6);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			color 120ms,
			border-color 120ms,
			background 120ms;
	}
	.mcp-trigger:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
		background: var(--accents-1);
	}
	.mcp-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sidebar.collapsed .mcp-trigger {
		width: auto;
		justify-content: center;
		padding: 0;
		align-self: center;
	}

	.user-trigger {
		width: 100%;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		font: inherit;
		font-size: 12px;
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		transition: background 120ms;
	}
	.sidebar.collapsed .user-trigger {
		justify-content: center;
		padding: 4px;
	}
	.user-trigger:hover {
		background: var(--accents-2);
	}
	.user-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		font-size: 12px;
		font-weight: 600;
		color: var(--geist-background);
		background: linear-gradient(135deg, var(--geist-foreground), var(--accents-7));
		border-radius: 50%;
		flex-shrink: 0;
	}
	.user-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.user-email {
		font-size: 12px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.user-role {
		font-size: 10px;
		color: var(--accents-5);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.user-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px 12px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 4px;
	}

	/* ----- theme toggle ----- */
	.theme-toggle {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		margin: 2px 4px 6px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.theme-pill {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 5px 8px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 100ms;
	}
	.theme-pill:hover {
		color: var(--geist-foreground);
	}
	.theme-pill.active {
		color: var(--geist-foreground);
		background: var(--surface);
		box-shadow: var(--shadow-smallest);
	}

	.skin-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0 4px 4px;
	}
	.skin-row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 6px 8px;
		font: inherit;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background 100ms;
	}
	.skin-row:hover {
		background: var(--accents-1);
	}
	.skin-row.active {
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 28%, transparent);
	}
	.skin-swatch {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		border: 1px solid var(--border-strong);
		box-shadow: var(--shadow-smallest);
	}
	.skin-swatch[data-skin-preview='editorial-luxe'] {
		background: linear-gradient(135deg, #4d53c1 0%, #c77fb0 55%, #e2b878 100%);
	}
	.skin-swatch[data-skin-preview='lumen'] {
		background: linear-gradient(135deg, #5b48f0 0%, #b06fd6 50%, #5fb6e8 100%);
	}
	.skin-swatch[data-skin-preview='voltaic'] {
		background: linear-gradient(135deg, #2f6df0 0%, #41c0e0 50%, #6a4bd6 100%);
	}
	.skin-swatch[data-skin-preview='terracotta'] {
		background: linear-gradient(135deg, #3f7d4e 0%, #c5703f 55%, #d9a23f 100%);
	}
	.skin-meta {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}
	.skin-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--geist-foreground);
		letter-spacing: -0.005em;
	}
	.skin-blurb {
		font-size: 10.5px;
		color: var(--accents-5);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.skin-row :global(.skin-check) {
		flex-shrink: 0;
		color: var(--accent);
	}

	.muted {
		padding: 12px;
		font-size: 12px;
		color: var(--accents-5);
		text-align: center;
	}
	.muted.small {
		font-size: 11px;
	}

	/* ----- modal form internals ----- */
	.modal-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: min(420px, 92vw);
		padding: 18px 20px 20px;
	}
	.modal-intro {
		margin: 0;
		font-size: 13px;
		color: var(--accents-5);
	}
	.modal-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.modal-field span {
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-5);
	}
	.modal-field input {
		width: 100%;
		height: 38px;
		padding: 0 12px;
		font: inherit;
		font-size: 14px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		outline: none;
		transition: border-color 120ms;
	}
	.modal-field input:focus {
		border-color: var(--geist-foreground);
	}
	.modal-error {
		margin: 0;
		font-size: 12px;
		color: var(--geist-error);
	}

	/* MCP install modal moved to its own component: McpInstallModal.svelte */
</style>
