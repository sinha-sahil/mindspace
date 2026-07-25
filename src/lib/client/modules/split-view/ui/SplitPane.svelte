<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { ProjectPane } from '$lib/client/modules/whiteboard';
	import { createProjectSession } from '$lib/client/modules/projects';
	import type { AppSupabaseClient } from '../../../../../app';

	// One split pane backed by a ProjectSession. The parent must wrap this in
	// {#key projectId} so the component (and its session) is replaced when the
	// pane's project changes — the session loads its project once on mount.

	type Props = {
		projectId: string;
		supabase: AppSupabaseClient | null;
		userId: string | null;
		userEmail: string | null;
		live: boolean;
		focused: boolean;
		onFocus: () => void;
		onClose: () => void;
	};
	let { projectId, supabase, userId, userEmail, live, focused, onFocus, onClose }: Props = $props();

	// Read props once, intentionally — {#key projectId} in the parent gives us a
	// fresh component (and a fresh session) whenever the pane's project changes.
	// untrack tells Svelte this initial-only capture is the design.
	const session = untrack(() => (supabase ? createProjectSession(supabase, projectId) : null));
	onDestroy(() => session?.destroy());
</script>

{#if !session}
	<div class="pane-state">Not signed in.</div>
{:else if session.loading}
	<div class="pane-state">Loading project…</div>
{:else if session.error}
	<div class="pane-state error">Couldn't load project — {session.error}</div>
{:else if session.project}
	{@const project = session.project}
	<ProjectPane
		{project}
		{live}
		{focused}
		compact
		{supabase}
		{userId}
		{userEmail}
		{onFocus}
		{onClose}
		saving={session.isSaving}
		onSceneChange={session.saveScene}
		onRename={session.rename}
		onSetVisibility={session.setVisibility}
	/>
{/if}

<style>
	.pane-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
		font-size: 13px;
		color: var(--muted);
		text-align: center;
	}
	.error {
		color: var(--rose);
	}
</style>
