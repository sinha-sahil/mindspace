<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { workspaces } from '$lib/client/modules/workspaces';
	import type { AppSupabaseClient } from '../../../../../app';

	type PickerProject = { id: string; name: string };

	type Props = {
		supabase: AppSupabaseClient | null;
		focused: boolean;
		onFocus: () => void;
		onClose: () => void;
		/** Fires when the user picks a project. The parent loads it into the pane. */
		onpick: (projectId: string) => void;
	};
	let { supabase, focused, onFocus, onClose, onpick }: Props = $props();

	let selectedWs = $state<string>(workspaces.activeId ?? workspaces.items[0]?.id ?? '');
	let projects = $state<PickerProject[]>([]);
	let loading = $state(false);
	let errorMsg = $state('');

	async function loadFor(wsId: string) {
		if (!supabase || !wsId) {
			return;
		}
		loading = true;
		errorMsg = '';
		const { data, error } = await supabase
			.from('projects')
			.select('id, name')
			.eq('workspace_id', wsId)
			.order('position', { ascending: true });
		if (error) {
			errorMsg = error.message;
			loading = false;
			return;
		}
		projects = (data ?? []).map((r) => ({ id: r.id, name: r.name }));
		loading = false;
	}

	function onWsChange(e: Event) {
		const target = e.currentTarget;
		if (!(target instanceof HTMLSelectElement)) {
			return;
		}
		selectedWs = target.value;
		loadFor(selectedWs);
	}

	onMount(() => {
		loadFor(selectedWs);
	});
</script>

<section
	class="picker"
	class:focused
	aria-label="Pick a project for this pane"
	tabindex="-1"
	onpointerdown={() => onFocus()}
>
	<header class="head">
		<span class="title">Pick a project for this pane</span>
		<button
			type="button"
			class="close"
			aria-label="Cancel split"
			onclick={(e) => {
				e.stopPropagation();
				onClose();
			}}
		>
			<Icon name="x" size={14} />
		</button>
	</header>

	<div class="body">
		<label class="field">
			<span class="label">Workspace</span>
			<select class="ws-select" value={selectedWs} onchange={onWsChange}>
				{#each workspaces.items as ws (ws.id)}
					<option value={ws.id}>{ws.name}</option>
				{/each}
			</select>
		</label>

		{#if loading}
			<p class="muted">Loading projects…</p>
		{:else if errorMsg}
			<p class="muted error">{errorMsg}</p>
		{:else if projects.length === 0}
			<p class="muted">No projects in this workspace yet.</p>
		{:else}
			<ul class="project-list">
				{#each projects as p (p.id)}
					<li>
						<button
							type="button"
							class="project-item"
							onclick={(e) => {
								e.stopPropagation();
								onpick(p.id);
							}}
						>
							<span class="project-icon"><Icon name="folder" size={13} /></span>
							<span class="project-name">{p.name}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	.picker {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--accents-1);
		position: relative;
		padding: 24px;
	}
	.picker.focused::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--accent, var(--geist-success));
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		color: var(--geist-foreground);
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		color: var(--accents-5);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.close:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
	}

	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 360px;
		margin: 0 auto;
		width: 100%;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--accents-5);
	}
	.ws-select {
		height: 34px;
		padding: 0 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		cursor: pointer;
	}

	.muted {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--accents-5);
	}
	.muted.error {
		color: var(--geist-error);
	}

	.project-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
		min-height: 0;
	}
	.project-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		cursor: pointer;
		text-align: left;
		transition: border-color 120ms;
	}
	.project-item:hover {
		border-color: var(--accents-3);
	}
	.project-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accents-6);
	}
	.project-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
