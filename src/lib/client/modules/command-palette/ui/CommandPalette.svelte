<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import Icon, { type IconName } from '$lib/client/components/Icon.svelte';
	import { commandPalette } from '../store.svelte';
	import { workspaces } from '$lib/client/modules/workspaces';
	import { projects } from '$lib/client/modules/projects';
	import { theme, type ThemeMode } from '$lib/client/modules/theme';
	import { toasts } from '$lib/client/modules/toasts';

	type Props = { isAdmin: boolean };
	let { isAdmin }: Props = $props();

	type Command = {
		id: string;
		label: string;
		hint: string | null;
		icon: IconName;
		group: 'projects' | 'workspaces' | 'navigate' | 'theme' | 'actions';
		keywords: string;
		run: () => void | Promise<void>;
	};

	let query = $state('');
	let cursor = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);

	const commands = $derived.by<Command[]>(() => {
		const list: Command[] = [];

		for (const project of projects.projects) {
			list.push({
				id: `project:${project.id}`,
				label: project.name,
				hint: 'Open project',
				icon: project.visibility === 'link' ? 'link' : 'folder',
				group: 'projects',
				keywords: project.name.toLowerCase(),
				run: () => projects.select(project.id)
			});
		}

		for (const ws of workspaces.items) {
			if (ws.id === workspaces.activeId) {
				continue;
			}
			list.push({
				id: `workspace:${ws.id}`,
				label: `Switch to ${ws.name}`,
				hint: 'Workspace',
				icon: 'folder',
				group: 'workspaces',
				keywords: ws.name.toLowerCase(),
				run: () => workspaces.select(ws.id)
			});
		}

		list.push({
			id: 'action:new-project',
			label: 'New project',
			hint: 'Create a project in this workspace',
			icon: 'plus',
			group: 'actions',
			keywords: 'new project create',
			run: async () => {
				const created = await projects.add();
				if (created) {
					toasts.success('Project created', { description: created.name });
				}
			}
		});

		list.push({
			id: 'action:copy-share-link',
			label: 'Copy share link',
			hint: projects.active ? `${projects.active.name} (public)` : 'No project selected',
			icon: 'link',
			group: 'actions',
			keywords: 'share link copy public',
			run: async () => {
				const id = projects.activeId;
				if (!id) {
					toasts.error('No project selected');
					return;
				}
				await projects.setVisibility(id, 'link');
				const url = `${window.location.origin}/p/${id}`;
				try {
					await navigator.clipboard.writeText(url);
					toasts.success('Share link copied', { description: url });
				} catch {
					toasts.info('Made public — copy this URL manually', { description: url });
				}
			}
		});

		list.push({
			id: 'navigate:passkeys',
			label: 'Passkeys',
			hint: 'Manage your hardware credentials',
			icon: 'key',
			group: 'navigate',
			keywords: 'passkey settings security',
			run: () => goto('/settings/passkeys')
		});

		if (isAdmin) {
			list.push({
				id: 'navigate:admin',
				label: 'Admin',
				hint: 'Members + invite links',
				icon: 'shield',
				group: 'navigate',
				keywords: 'admin members invites',
				run: () => goto('/admin')
			});
		}

		const themeOptions: { mode: ThemeMode; label: string; icon: IconName }[] = [
			{ mode: 'light', label: 'Light', icon: 'sun' },
			{ mode: 'dark', label: 'Dark', icon: 'moon' },
			{ mode: 'system', label: 'System', icon: 'monitor' }
		];
		for (const opt of themeOptions) {
			if (theme.mode === opt.mode) {
				continue;
			}
			list.push({
				id: `theme:${opt.mode}`,
				label: `Theme · ${opt.label}`,
				hint: 'Switch appearance',
				icon: opt.icon,
				group: 'theme',
				keywords: `theme ${opt.label.toLowerCase()}`,
				run: () => {
					theme.set(opt.mode);
					toasts.info(`Theme: ${opt.label}`);
				}
			});
		}

		list.push({
			id: 'action:sign-out',
			label: 'Sign out',
			hint: 'End this session',
			icon: 'logout',
			group: 'actions',
			keywords: 'sign out logout',
			run: () => {
				const form = document.createElement('form');
				form.method = 'POST';
				form.action = '/auth/logout';
				document.body.appendChild(form);
				form.submit();
			}
		});

		return list;
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) {
			return commands;
		}
		const score = (cmd: Command): number => {
			const label = cmd.label.toLowerCase();
			if (label === q) {
				return 1000;
			}
			if (label.startsWith(q)) {
				return 500;
			}
			if (label.includes(q)) {
				return 200;
			}
			if (cmd.keywords.includes(q)) {
				return 100;
			}
			let i = 0;
			for (const ch of label) {
				if (ch === q[i]) {
					i += 1;
				}
				if (i === q.length) {
					return 50;
				}
			}
			return 0;
		};
		const scored = commands.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0);
		scored.sort((a, b) => b.s - a.s);
		return scored.map((x) => x.c);
	});

	const grouped = $derived.by(() => {
		const groups = new Map<Command['group'], Command[]>();
		const order: Command['group'][] = [
			'projects',
			'workspaces',
			'actions',
			'navigate',
			'theme'
		];
		for (const g of order) {
			groups.set(g, []);
		}
		for (const cmd of filtered) {
			groups.get(cmd.group)?.push(cmd);
		}
		return order.map((g) => ({ group: g, items: groups.get(g) ?? [] })).filter((x) => x.items.length > 0);
	});

	const flat = $derived(grouped.flatMap((g) => g.items));

	$effect.pre(() => {
		// Reset cursor whenever the filtered set changes.
		void filtered;
		cursor = 0;
	});

	function paletteEffects(node: HTMLElement, params: { active: boolean }) {
		let active = params.active;

		function handleKey(e: KeyboardEvent) {
			const meta = e.metaKey || e.ctrlKey;
			if (meta && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				commandPalette.toggle();
				return;
			}
			if (!active) {
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				commandPalette.setOpen(false);
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				cursor = Math.min(cursor + 1, Math.max(0, flat.length - 1));
				ensureVisible();
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				cursor = Math.max(cursor - 1, 0);
				ensureVisible();
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				const cmd = flat[cursor];
				if (cmd) {
					runCommand(cmd);
				}
			}
		}

		window.addEventListener('keydown', handleKey);
		return {
			update(next: { active: boolean }) {
				active = next.active;
			},
			destroy() {
				window.removeEventListener('keydown', handleKey);
			}
		};
	}

	function ensureVisible() {
		queueMicrotask(() => {
			const el = listEl?.querySelector<HTMLElement>(`[data-cursor="${cursor}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	async function runCommand(cmd: Command) {
		commandPalette.setOpen(false);
		try {
			await cmd.run();
		} catch (err) {
			toasts.error('Command failed', {
				description: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}

	function focusInput(node: HTMLInputElement, active: boolean) {
		if (active) {
			queueMicrotask(() => node.select());
		}
		return {
			update(next: boolean) {
				if (next) {
					queueMicrotask(() => node.select());
				}
			}
		};
	}

	function groupLabel(group: Command['group']): string {
		switch (group) {
			case 'projects':
				return 'Projects';
			case 'workspaces':
				return 'Workspaces';
			case 'navigate':
				return 'Navigate';
			case 'theme':
				return 'Theme';
			case 'actions':
				return 'Actions';
		}
	}
</script>

<svelte:body use:paletteEffects={{ active: commandPalette.open }} />

{#if commandPalette.open}
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Command palette"
		tabindex="-1"
		onmousedown={(e) => {
			if (e.target === e.currentTarget) {
				commandPalette.setOpen(false);
			}
		}}
		transition:fade={{ duration: 120 }}
	>
		<div
			class="palette"
			transition:scale={{ duration: 160, start: 0.97, easing: cubicOut }}
		>
			<header class="search">
				<Icon name="search" size={15} class="search-icon" />
				<input
					bind:this={inputEl}
					bind:value={query}
					use:focusInput={commandPalette.open}
					placeholder="Type a command, search projects…"
					autocomplete="off"
					spellcheck="false"
				/>
				<kbd class="kbd">Esc</kbd>
			</header>

			<div bind:this={listEl} class="list" role="listbox">
				{#if flat.length === 0}
					<div class="empty">
						<Icon name="search" size={20} class="empty-icon" />
						<p>No commands match "{query}"</p>
					</div>
				{:else}
					{#each grouped as section (section.group)}
						<div class="group-label">{groupLabel(section.group)}</div>
						{#each section.items as cmd (cmd.id)}
							{@const idx = flat.indexOf(cmd)}
							{@const active = cursor === idx}
							<button
								type="button"
								class="row"
								class:active
								data-cursor={idx}
								role="option"
								aria-selected={active}
								onmouseenter={() => (cursor = idx)}
								onclick={() => runCommand(cmd)}
							>
								<span class="row-icon">
									<Icon name={cmd.icon} size={14} />
								</span>
								<span class="row-meta">
									<span class="row-label">{cmd.label}</span>
									{#if cmd.hint}
										<span class="row-hint">{cmd.hint}</span>
									{/if}
								</span>
								{#if active}
									<kbd class="kbd subtle">↵</kbd>
								{/if}
							</button>
						{/each}
					{/each}
				{/if}
			</div>

			<footer class="foot">
				<span class="foot-hint">
					<kbd class="kbd subtle">↑↓</kbd>
					Navigate
				</span>
				<span class="foot-hint">
					<kbd class="kbd subtle">↵</kbd>
					Run
				</span>
				<span class="foot-hint">
					<kbd class="kbd subtle">Esc</kbd>
					Close
				</span>
			</footer>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 250;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 11vh 24px 24px;
		background: color-mix(in srgb, var(--geist-foreground) 18%, transparent);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}

	.palette {
		width: 100%;
		max-width: 580px;
		display: flex;
		flex-direction: column;
		max-height: 70vh;
		background: color-mix(in srgb, var(--surface) 88%, var(--accents-1) 12%);
		border: 1px solid var(--border);
		border-radius: 14px;
		overflow: hidden;
		box-shadow:
			0 1px 0 0 color-mix(in srgb, var(--geist-foreground) 8%, transparent) inset,
			0 60px 120px -30px rgba(0, 0, 0, 0.55),
			0 18px 40px -16px rgba(0, 0, 0, 0.35);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
	}
	:global(.search-icon) {
		color: var(--accents-4);
	}
	.search input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 14px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		outline: none;
	}
	.search input::placeholder {
		color: var(--accents-4);
	}

	.kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 20px;
		padding: 0 5px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 5px;
		box-shadow: 0 1px 0 0 var(--border);
	}
	.kbd.subtle {
		background: transparent;
		box-shadow: none;
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}

	.group-label {
		padding: 8px 8px 4px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accents-5);
	}

	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		transition: background 80ms;
	}
	.row.active {
		background: color-mix(in srgb, var(--accents-1) 80%, var(--geist-foreground) 4%);
	}
	.row-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		flex-shrink: 0;
	}
	.row.active .row-icon {
		color: var(--geist-foreground);
		background: var(--surface);
		border-color: var(--accents-3);
	}
	.row-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.row-label {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-hint {
		font-size: 11px;
		color: var(--accents-5);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 32px 16px;
		text-align: center;
	}
	:global(.empty-icon) {
		color: var(--accents-4);
	}
	.empty p {
		margin: 0;
		font-size: 13px;
		color: var(--accents-5);
	}

	.foot {
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 8px 14px;
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--accents-1) 60%, transparent);
		font-size: 11px;
		color: var(--accents-5);
	}
	.foot-hint {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
