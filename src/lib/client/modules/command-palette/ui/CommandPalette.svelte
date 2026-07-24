<script lang="ts">
	import { CommandMenu } from 'polymorph-ui-components';
	import { goto } from '$app/navigation';
	import Icon, { type IconName } from '$lib/client/components/Icon.svelte';
	import { commandPalette } from '../store.svelte';
	import { workspaces } from '$lib/client/modules/workspaces';
	import { projects } from '$lib/client/modules/projects';
	import { theme, type ThemeMode, ACCENTS } from '$lib/client/modules/theme';
	import { toasts } from '$lib/client/modules/toasts';

	type Props = { isAdmin: boolean };
	let { isAdmin }: Props = $props();

	type Command = {
		value: string;
		label: string;
		group: string;
		icon: IconName;
		run: () => void | Promise<void>;
	};

	// The full command set, rebuilt whenever projects/workspaces/theme change.
	// Ordering here is the order CommandMenu renders the groups in.
	const commands = $derived.by<Command[]>(() => {
		const projectCmds: Command[] = [];
		const workspaceCmds: Command[] = [];
		const actionCmds: Command[] = [];
		const navigateCmds: Command[] = [];
		const themeCmds: Command[] = [];
		const accentCmds: Command[] = [];

		for (const project of projects.projects) {
			projectCmds.push({
				value: `project:${project.id}`,
				label: project.name,
				group: 'Projects',
				icon: project.visibility === 'link' ? 'link' : 'folder',
				run: () => projects.select(project.id)
			});
		}

		for (const ws of workspaces.items) {
			if (ws.id === workspaces.activeId) {
				continue;
			}
			workspaceCmds.push({
				value: `workspace:${ws.id}`,
				label: `Switch to ${ws.name}`,
				group: 'Workspaces',
				icon: 'folder',
				run: () => workspaces.select(ws.id)
			});
		}

		actionCmds.push({
			value: 'action:new-project',
			label: 'New project',
			group: 'Actions',
			icon: 'plus',
			run: async () => {
				const created = await projects.add();
				if (created) {
					toasts.success('Project created', { description: created.name });
				}
			}
		});

		actionCmds.push({
			value: 'action:new-doc-project',
			label: 'New doc project',
			group: 'Actions',
			icon: 'pencil',
			run: async () => {
				const created = await projects.add('', 'doc');
				if (created) {
					toasts.success('Doc project created', { description: created.name });
				}
			}
		});

		actionCmds.push({
			value: 'action:copy-share-link',
			label: 'Copy share link',
			group: 'Actions',
			icon: 'link',
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

		navigateCmds.push({
			value: 'navigate:passkeys',
			label: 'Passkeys',
			group: 'Navigate',
			icon: 'key',
			run: () => goto('/settings/passkeys')
		});

		if (isAdmin) {
			navigateCmds.push({
				value: 'navigate:admin',
				label: 'Admin',
				group: 'Navigate',
				icon: 'shield',
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
			themeCmds.push({
				value: `theme:${opt.mode}`,
				label: `Theme · ${opt.label}`,
				group: 'Theme',
				icon: opt.icon,
				run: () => {
					theme.set(opt.mode);
					toasts.info(`Theme: ${opt.label}`);
				}
			});
		}

		for (const a of ACCENTS) {
			if (theme.accent === a.id) {
				continue;
			}
			accentCmds.push({
				value: `accent:${a.id}`,
				label: `Accent · ${a.label}`,
				group: 'Theme',
				icon: 'sparkles',
				run: () => {
					theme.setAccent(a.id);
					toasts.info(`Accent: ${a.label}`);
				}
			});
		}

		actionCmds.push({
			value: 'action:sign-out',
			label: 'Sign out',
			group: 'Actions',
			icon: 'logout',
			run: () => {
				const form = document.createElement('form');
				form.method = 'POST';
				form.action = '/auth/logout';
				document.body.appendChild(form);
				form.submit();
			}
		});

		return [
			...projectCmds,
			...workspaceCmds,
			...actionCmds,
			...navigateCmds,
			...themeCmds,
			...accentCmds
		];
	});

	// CommandMenu wants plain { label, value, group } items; the run handler and
	// icon live on the Command and are looked up by value when needed.
	const menuItems = $derived(
		commands.map((c) => ({ label: c.label, value: c.value, group: c.group }))
	);

	async function runCommand(value: string) {
		const cmd = commands.find((c) => c.value === value);
		if (!cmd) {
			return;
		}
		try {
			await cmd.run();
		} catch (err) {
			toasts.error('Command failed', {
				description: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}
</script>

<CommandMenu
	classes="ms-command-menu"
	items={menuItems}
	bind:open={commandPalette.open}
	placeholder="Type a command, search projects…"
	emptyText="No commands match your search."
	onselect={(item) => runCommand(item.value)}
>
	{#snippet searchIcon()}
		<Icon name="search" size={16} />
	{/snippet}
	{#snippet itemIcon(item)}
		{@const cmd = commands.find((c) => c.value === item.value)}
		{#if cmd}
			<span class="cmd-icon"><Icon name={cmd.icon} size={15} /></span>
		{/if}
	{/snippet}
</CommandMenu>

<style>
	.cmd-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accents-6);
	}
</style>
