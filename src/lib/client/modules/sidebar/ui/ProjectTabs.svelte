<script lang="ts">
	import { Tabs, type TabItem } from 'polymorph-ui-components';
	import Icon from '$lib/client/components/Icon.svelte';
	import { projects, KIND_ICONS } from '$lib/client/modules/projects';
	import { splitView } from '$lib/client/modules/split-view';
	import { tintForKey } from '$lib/client/utils/color';

	/**
	 * The project tab strip shown above the workarea while the sidebar is
	 * collapsed — tabs and nothing else; every other tool stays in the rail
	 * (docs/design.md). Labeled tabs with tinted kind icons; the accent
	 * underline marks the current project; overflow scrolls with arrows.
	 */
	const items = $derived<TabItem[]>(projects.projects.map((p) => ({ key: p.id, label: p.name })));

	function selectByKey(key: string) {
		if (splitView.enabled && splitView.focused === 'right') {
			splitView.setRight(key);
			return;
		}
		projects.select(key);
	}
</script>

{#if items.length > 0}
	<div class="project-tabs">
		<Tabs classes="ms-tabs" {items} activeKey={projects.activeId ?? ''} onkeychange={selectByKey}>
			{#snippet tab({ index, label, active })}
				{@const project = projects.projects[index]}
				{#if project}
					<span
						class="ttab"
						class:active
						style="--tint: {tintForKey(project.id).hex};"
						title={label}
					>
						<Icon name={KIND_ICONS[project.kind]} size={13} />
						<span class="ttab-label">{label}</span>
					</span>
				{:else}
					<span class="ttab"><span class="ttab-label">{label}</span></span>
				{/if}
			{/snippet}
		</Tabs>
	</div>
{/if}

<style>
	.project-tabs {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 44px;
		padding: 0 8px;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
		min-width: 0;
	}
	.project-tabs :global(.ms-tabs) {
		width: 100%;
		min-width: 0;
	}
	.ttab {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.ttab :global(.icon) {
		flex-shrink: 0;
		color: color-mix(in srgb, var(--tint, var(--muted)) 65%, var(--muted));
	}
	.ttab-label {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--fg-2);
	}
	.ttab.active .ttab-label {
		color: var(--fg);
	}
	.ttab.active :global(.icon) {
		color: var(--accent);
	}
</style>
