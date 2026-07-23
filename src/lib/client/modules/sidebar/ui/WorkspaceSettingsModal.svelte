<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { Modal, Button } from 'polymorph-ui-components';
	import Icon from '$lib/client/components/Icon.svelte';
	import { workspaces, type Workspace } from '$lib/client/modules/workspaces';
	import { toasts } from '$lib/client/modules/toasts';
	import { analytics } from '$lib/client/modules/analytics';
	import { initialFor, colorForKey } from '$lib/client/utils/color';

	type Member = {
		userId: string;
		email: string;
		role: 'editor' | 'viewer';
		addedAt: string;
	};

	type Props = {
		workspace: Workspace | null;
		isOwner: boolean;
		onClose: () => void;
	};
	let { workspace, isOwner, onClose }: Props = $props();

	let renameDraft = $state('');
	let renameSaving = $state(false);
	let renameError = $state('');

	let members = $state<Member[]>([]);
	let loadingMembers = $state(true);
	let membersError = $state('');

	let pickerQuery = $state('');
	let pickerSuggestions = $state<string[]>([]);
	let pickerOpen = $state(false);
	let pickerRole = $state<'editor' | 'viewer'>('editor');
	let pickerActiveIdx = $state(0);
	let addingMember = $state(false);
	let addError = $state('');

	let searchToken = 0;

	// Reset the form and load members when the modal's content mounts (the
	// modal is shown) and whenever the workspace it's pointed at changes.
	const initForWorkspace: Attachment = () => {
		const ws = workspace;
		if (!ws) {
			return;
		}
		renameDraft = ws.name;
		renameError = '';
		addError = '';
		pickerQuery = '';
		pickerSuggestions = [];
		pickerOpen = false;
		loadMembers(ws.id);
	};

	async function loadMembers(workspaceId: string) {
		loadingMembers = true;
		membersError = '';
		try {
			const res = await fetch(`/api/workspaces/${workspaceId}/members`);
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			const data: { members: Member[] } = await res.json();
			members = data.members;
		} catch (e) {
			membersError = e instanceof Error ? e.message : 'Failed to load members';
		} finally {
			loadingMembers = false;
		}
	}

	async function searchPicker(q: string) {
		const token = ++searchToken;
		try {
			const res = await fetch(`/api/app-members${q ? `?q=${encodeURIComponent(q)}` : ''}`);
			if (!res.ok) {
				return;
			}
			const data: { emails: string[] } = await res.json();
			if (token !== searchToken) {
				return;
			}
			// Hide already-added members from suggestions.
			const existing = new Set(members.map((m) => m.email.toLowerCase()));
			pickerSuggestions = data.emails.filter((e) => !existing.has(e.toLowerCase()));
			pickerActiveIdx = 0;
		} catch {
			pickerSuggestions = [];
		}
	}

	function onPickerInput() {
		pickerOpen = true;
		searchPicker(pickerQuery.trim());
	}

	function onPickerFocus() {
		pickerOpen = true;
		if (pickerSuggestions.length === 0) {
			searchPicker(pickerQuery.trim());
		}
	}

	function pickSuggestion(email: string) {
		pickerQuery = email;
		pickerOpen = false;
		queueMicrotask(() => addMember());
	}

	function onPickerKeydown(e: KeyboardEvent) {
		if (!pickerOpen || pickerSuggestions.length === 0) {
			if (e.key === 'Enter') {
				e.preventDefault();
				addMember();
			}
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			pickerActiveIdx = (pickerActiveIdx + 1) % pickerSuggestions.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			pickerActiveIdx = (pickerActiveIdx - 1 + pickerSuggestions.length) % pickerSuggestions.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			pickSuggestion(pickerSuggestions[pickerActiveIdx]);
		} else if (e.key === 'Escape') {
			pickerOpen = false;
		}
	}

	async function addMember() {
		const ws = workspace;
		if (!ws) {
			return;
		}
		const email = pickerQuery.trim().toLowerCase();
		if (!email || !email.includes('@')) {
			addError = 'Enter a valid email address';
			return;
		}
		addError = '';
		addingMember = true;
		try {
			const res = await fetch(`/api/workspaces/${ws.id}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role: pickerRole })
			});
			if (!res.ok) {
				const txt = (await res.text()) || `Request failed (${res.status})`;
				throw new Error(txt);
			}
			pickerQuery = '';
			pickerOpen = false;
			pickerSuggestions = [];
			toasts.success('Member added', { description: email });
			analytics.track('workspace_member_added', {
				workspace_id: ws.id,
				role: pickerRole
			});
			await loadMembers(ws.id);
		} catch (e) {
			addError = e instanceof Error ? e.message : 'Could not add member';
		} finally {
			addingMember = false;
		}
	}

	async function changeRole(member: Member, role: 'editor' | 'viewer') {
		const ws = workspace;
		if (!ws || member.role === role) {
			return;
		}
		const previous = member.role;
		member.role = role;
		try {
			const res = await fetch(`/api/workspaces/${ws.id}/members/${member.userId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role })
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			analytics.track('workspace_member_role_changed', {
				workspace_id: ws.id,
				role
			});
		} catch (e) {
			member.role = previous;
			toasts.error('Could not change role', {
				description: e instanceof Error ? e.message : ''
			});
		}
	}

	async function removeMember(member: Member) {
		const ws = workspace;
		if (!ws) {
			return;
		}
		const previous = members;
		members = members.filter((m) => m.userId !== member.userId);
		try {
			const res = await fetch(`/api/workspaces/${ws.id}/members/${member.userId}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			toasts.info('Member removed', { description: member.email });
			analytics.track('workspace_member_removed', { workspace_id: ws.id });
		} catch (e) {
			members = previous;
			toasts.error('Could not remove member', {
				description: e instanceof Error ? e.message : ''
			});
		}
	}

	async function saveRename() {
		const ws = workspace;
		if (!ws) {
			return;
		}
		const next = renameDraft.trim();
		if (!next) {
			renameError = 'Name is required';
			return;
		}
		if (next === ws.name) {
			return;
		}
		renameSaving = true;
		renameError = '';
		try {
			await workspaces.rename(ws.id, next);
			toasts.success('Workspace renamed', { description: next });
		} catch (e) {
			renameError = e instanceof Error ? e.message : 'Rename failed';
		} finally {
			renameSaving = false;
		}
	}
</script>

{#if workspace}
	<Modal
		classes="ms-modal"
		size="fit-content"
		header={{ text: 'Workspace settings' }}
		onoverlayclick={onClose}
	>
		{#snippet content()}
			{#if workspace}
				{@const wsColor = colorForKey(workspace.id)}
				<div class="ws-settings" {@attach initForWorkspace}>
					<div class="ws-card">
						<span
							class="ws-tile"
							style="--tile-from: {wsColor.from}; --tile-to: {wsColor.to};"
							aria-hidden="true"
						>
							{initialFor(workspace.name)}
						</span>
						<div class="ws-meta">
							<span class="ws-name">{workspace.name}</span>
							<span class="ws-sub">
								{members.length === 0
									? 'Owner only'
									: `${members.length + 1} member${members.length === 0 ? '' : 's'}`}
							</span>
						</div>
					</div>

					<section class="block">
						<div class="block-label">Name</div>
						<div class="rename-row">
							<input
								type="text"
								class="text-input"
								bind:value={renameDraft}
								maxlength="80"
								disabled={!isOwner || renameSaving}
								placeholder="Workspace name"
							/>
							<button
								type="button"
								class="btn primary"
								disabled={!isOwner ||
									renameSaving ||
									!renameDraft.trim() ||
									renameDraft.trim() === workspace.name}
								onclick={saveRename}
							>
								{renameSaving ? 'Saving…' : 'Save'}
							</button>
						</div>
						{#if renameError}
							<p class="error">{renameError}</p>
						{/if}
						{#if !isOwner}
							<p class="hint">Only the workspace owner can rename it.</p>
						{/if}
					</section>

					<section class="block">
						<div class="block-label">Members</div>

						{#if loadingMembers}
							<p class="hint">Loading…</p>
						{:else if membersError}
							<p class="error">{membersError}</p>
						{:else if members.length === 0}
							<p class="hint">No one else has access yet.</p>
						{:else}
							<ul class="member-list">
								{#each members as m (m.userId)}
									<li class="member">
										<span class="member-email">{m.email}</span>
										{#if isOwner}
											<select
												class="role-select"
												value={m.role}
												onchange={(e) => {
													const next = e.currentTarget.value;
													if (next === 'editor' || next === 'viewer') {
														changeRole(m, next);
													}
												}}
											>
												<option value="editor">Editor</option>
												<option value="viewer">Viewer</option>
											</select>
											<button
												type="button"
												class="member-remove"
												title="Remove"
												aria-label="Remove member"
												onclick={() => removeMember(m)}
											>
												<Icon name="trash" size={13} />
											</button>
										{:else}
											<span class="role-pill">{m.role}</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if isOwner}
							<div class="add-row">
								<div class="picker-wrap">
									<input
										type="email"
										class="text-input"
										placeholder="Add by email"
										bind:value={pickerQuery}
										oninput={onPickerInput}
										onfocus={onPickerFocus}
										onkeydown={onPickerKeydown}
										disabled={addingMember}
										autocomplete="off"
									/>
									{#if pickerOpen && pickerSuggestions.length > 0}
										<ul class="picker-suggestions" role="listbox">
											{#each pickerSuggestions as email, i (email)}
												<li>
													<button
														type="button"
														class="picker-suggestion"
														class:active={i === pickerActiveIdx}
														onmousedown={(e) => {
															e.preventDefault();
															pickSuggestion(email);
														}}
													>
														{email}
													</button>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
								<select class="role-select" bind:value={pickerRole} disabled={addingMember}>
									<option value="editor">Editor</option>
									<option value="viewer">Viewer</option>
								</select>
								<button
									type="button"
									class="btn primary"
									onclick={addMember}
									disabled={addingMember || !pickerQuery.trim()}
								>
									{addingMember ? 'Adding…' : 'Add'}
								</button>
							</div>
							{#if addError}
								<p class="error">{addError}</p>
							{/if}
						{/if}
					</section>
				</div>
			{/if}
		{/snippet}
		{#snippet footerSnippet()}
			<Button text="Done" classes="btn-secondary" onclick={onClose} />
		{/snippet}
	</Modal>
{/if}

<style>
	.ws-settings {
		width: min(480px, 92vw);
		padding: 18px 20px 20px;
	}
	.ws-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 4px 0 14px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 14px;
	}
	.ws-tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		font-size: 14px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.96);
		background: linear-gradient(135deg, var(--tile-from), var(--tile-to));
		border-radius: 10px;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.2) inset;
	}
	.ws-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.ws-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--geist-foreground);
	}
	.ws-sub {
		font-size: 11px;
		color: var(--accents-5);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 0;
	}
	.block + .block {
		border-top: 1px solid var(--border);
	}
	.block-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--accents-5);
	}

	.text-input {
		flex: 1;
		min-width: 0;
		height: 32px;
		padding: 0 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		outline: none;
		transition: border-color 120ms;
	}
	.text-input:focus {
		border-color: var(--accent, var(--geist-foreground));
	}
	.text-input:disabled {
		opacity: 0.6;
	}

	.rename-row,
	.add-row {
		display: flex;
		gap: 6px;
		align-items: stretch;
	}
	.add-row .picker-wrap {
		flex: 1;
		position: relative;
	}

	.role-select {
		height: 32px;
		padding: 0 8px;
		font: inherit;
		font-size: 12px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		cursor: pointer;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 32px;
		padding: 0 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		border-radius: 7px;
		border: 1px solid;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn.primary {
		color: var(--geist-background);
		background: var(--geist-foreground);
		border-color: var(--geist-foreground);
	}
	.btn.primary:hover:not(:disabled) {
		opacity: 0.9;
	}

	.error {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--geist-error);
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--accents-5);
	}

	.member-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.member {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 7px;
	}
	.member-email {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: var(--geist-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.member-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		color: var(--accents-5);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 5px;
		cursor: pointer;
		transition:
			color 120ms,
			background 120ms,
			border-color 120ms;
	}
	.member-remove:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
		border-color: rgba(238, 0, 0, 0.2);
	}
	.role-pill {
		font-size: 11px;
		color: var(--accents-6);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.picker-suggestions {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		z-index: 10;
		max-height: 200px;
		overflow-y: auto;
		list-style: none;
		padding: 4px;
		margin: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 7px;
		box-shadow: var(--shadow-medium);
	}
	.picker-suggestion {
		display: block;
		width: 100%;
		text-align: left;
		padding: 6px 8px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
	}
	.picker-suggestion:hover,
	.picker-suggestion.active {
		background: var(--accents-1);
	}
</style>
