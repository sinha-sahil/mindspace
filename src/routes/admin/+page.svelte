<script lang="ts">
	import { enhance } from '$app/forms';
	import Logo from '$lib/client/components/Logo.svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { formatDate as fmtDate } from '$lib/client/utils/format';
	import { parseWorkspaceInviteNote } from '$lib/shared/workspace-invite-note';

	/** Workspace invites store their grant as JSON in `note` — render it
	 *  as a readable label instead of the raw blob. */
	function inviteLabel(note: string | null): string {
		const ws = parseWorkspaceInviteNote(note);
		if (ws) {
			return `Workspace invite — “${ws.workspaceName}” (${ws.role})`;
		}
		return note || 'Untitled invite';
	}

	let { data, form } = $props();

	type Tab = 'members' | 'invites';
	let tab = $state<Tab>('members');
	let copiedToken = $state<string | null>(null);

	function inviteUrl(token: string) {
		if (typeof window === 'undefined') {
			return `/invite/${token}`;
		}
		return `${window.location.origin}/invite/${token}`;
	}

	async function copyInvite(token: string) {
		try {
			await navigator.clipboard.writeText(inviteUrl(token));
			copiedToken = token;
			setTimeout(() => {
				if (copiedToken === token) {
					copiedToken = null;
				}
			}, 1500);
		} catch {
			/* clipboard rejected */
		}
	}

	function inviteStatus(invite: {
		max_uses: number | null;
		use_count: number;
		expires_at: string | null;
	}) {
		if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
			return 'Expired';
		}
		if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
			return 'Used up';
		}
		return 'Active';
	}
</script>

<div class="page">
	<header class="topbar">
		<div class="crumbs">
			<a href="/" class="brand">
				<Logo size={18} />
				<span class="brand-text">mindspace</span>
			</a>
			<Icon name="chevron-right" size={12} class="crumb-sep" />
			<span class="crumb current">Admin</span>
		</div>
		<a href="/" class="back-link">
			<Icon name="arrow-up-right" size={13} />
			<span>Back to app</span>
		</a>
	</header>

	<main>
		<section class="hero">
			<div class="hero-icon">
				<Icon name="shield" size={20} />
			</div>
			<div>
				<h1>App access</h1>
				<p>
					Mindspace is invite-only. Manage who can sign in and generate one-link invites that do the
					work for you.
				</p>
			</div>
		</section>

		{#if form?.message}
			<div class="banner error">
				<Icon name="x" size={16} />
				<span>{form.message}</span>
			</div>
		{/if}

		<div class="tabs" role="tablist">
			<button
				role="tab"
				aria-selected={tab === 'members'}
				class="tab"
				class:active={tab === 'members'}
				onclick={() => (tab = 'members')}
			>
				<Icon name="circle-dot" size={13} />
				<span>Members</span>
				<span class="tab-count">{data.members.length}</span>
			</button>
			<button
				role="tab"
				aria-selected={tab === 'invites'}
				class="tab"
				class:active={tab === 'invites'}
				onclick={() => (tab = 'invites')}
			>
				<Icon name="link" size={13} />
				<span>Invites</span>
				<span class="tab-count">{data.invites.length}</span>
			</button>
		</div>

		{#if tab === 'members'}
			<section class="card">
				<header class="card-head">
					<h2>Add member</h2>
					<p>Manually add an email. Use invite links for self-service.</p>
				</header>
				<form method="POST" action="?/add" use:enhance class="card-form">
					<label class="field">
						<span class="field-label">Email</span>
						<div class="field-wrap">
							<span class="field-icon"><Icon name="mail" size={14} /></span>
							<input
								name="email"
								type="email"
								required
								placeholder="user@example.com"
								autocomplete="off"
							/>
						</div>
					</label>
					<label class="checkbox">
						<input name="is_admin" type="checkbox" />
						<span>Grant admin</span>
					</label>
					<button type="submit" class="btn primary">
						<Icon name="plus" size={14} />
						<span>Add</span>
					</button>
				</form>
			</section>

			<section class="card">
				<header class="card-head">
					<h2>All members <span class="count">{data.members.length}</span></h2>
				</header>
				<ul class="data-list">
					{#each data.members as m (m.email)}
						<li class="data-row">
							<div class="row-icon">
								<Icon name="mail" size={14} />
							</div>
							<div class="row-meta">
								<div class="row-title">{m.email}</div>
								<div class="row-sub">Added {fmtDate(m.created_at)}</div>
							</div>
							<form method="POST" action="?/toggleAdmin" use:enhance class="inline-form">
								<input type="hidden" name="email" value={m.email} />
								<input type="hidden" name="is_admin" value={(!m.is_admin).toString()} />
								<button type="submit" class="role-pill" class:admin={m.is_admin}>
									<Icon name={m.is_admin ? 'shield' : 'circle'} size={11} />
									<span>{m.is_admin ? 'Admin' : 'Member'}</span>
								</button>
							</form>
							<form method="POST" action="?/remove" use:enhance class="inline-form">
								<input type="hidden" name="email" value={m.email} />
								<button type="submit" class="btn ghost danger">
									<Icon name="trash" size={12} />
									<span>Remove</span>
								</button>
							</form>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<section class="card">
				<header class="card-head">
					<h2>Generate an invite link</h2>
					<p>Anyone with the link can add themselves to the allowlist.</p>
				</header>
				<form method="POST" action="?/createInvite" use:enhance class="card-form invite-form">
					<label class="field grow">
						<span class="field-label">Note <em>(optional)</em></span>
						<div class="field-wrap">
							<span class="field-icon"><Icon name="pencil" size={14} /></span>
							<input name="note" type="text" placeholder="e.g. design team" maxlength="80" />
						</div>
					</label>
					<label class="field narrow">
						<span class="field-label">Max uses</span>
						<input name="max_uses" type="number" min="1" placeholder="∞" />
					</label>
					<label class="field narrow">
						<span class="field-label">Days until expiry</span>
						<input name="expires_in_days" type="number" min="1" placeholder="∞" />
					</label>
					<label class="checkbox">
						<input name="grant_admin" type="checkbox" />
						<span>Grant admin</span>
					</label>
					<button type="submit" class="btn primary">
						<Icon name="link" size={14} />
						<span>Generate</span>
					</button>
				</form>
			</section>

			<section class="card">
				<header class="card-head">
					<h2>Invites <span class="count">{data.invites.length}</span></h2>
				</header>
				{#if data.invites.length === 0}
					<div class="empty">
						<Icon name="link" size={20} class="empty-icon" />
						<p>No invites yet.</p>
					</div>
				{:else}
					<ul class="data-list">
						{#each data.invites as inv (inv.token)}
							{@const status = inviteStatus(inv)}
							<li class="data-row invite">
								<div class="row-icon">
									<Icon name="link" size={14} />
								</div>
								<div class="row-meta">
									<div class="row-title">
										<span>{inviteLabel(inv.note)}</span>
										{#if inv.grant_admin}
											<span class="badge admin">
												<Icon name="shield" size={9} />
												<span>admin</span>
											</span>
										{/if}
									</div>
									<div class="row-sub">
										<span class="status-dot {status === 'Active' ? 'on' : 'off'}"></span>
										<span>{status}</span>
										<span class="dot-sep">·</span>
										<span>
											{inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ''} uses
										</span>
										<span class="dot-sep">·</span>
										<span>
											{inv.expires_at ? `expires ${fmtDate(inv.expires_at)}` : 'no expiry'}
										</span>
										<span class="dot-sep">·</span>
										<span class="token">…{inv.token.slice(-10)}</span>
									</div>
								</div>
								<button class="btn ghost" onclick={() => copyInvite(inv.token)}>
									<Icon name={copiedToken === inv.token ? 'check' : 'copy'} size={12} />
									<span>{copiedToken === inv.token ? 'Copied' : 'Copy link'}</span>
								</button>
								<form method="POST" action="?/revokeInvite" use:enhance class="inline-form">
									<input type="hidden" name="token" value={inv.token} />
									<button type="submit" class="btn ghost danger">
										<Icon name="trash" size={12} />
										<span>Revoke</span>
									</button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--geist-background);
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 24px;
		border-bottom: 1px solid var(--border);
	}
	.crumbs {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		color: var(--geist-foreground);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.crumb {
		font-size: 13px;
		color: var(--accents-5);
	}
	.crumb.current {
		color: var(--geist-foreground);
		font-weight: 500;
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--accents-5);
		text-decoration: none;
	}
	.back-link:hover {
		color: var(--geist-foreground);
	}

	main {
		max-width: 880px;
		margin: 0 auto;
		padding: 40px 24px 80px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.hero {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		padding: 0 0 8px;
	}
	.hero-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		color: var(--geist-foreground);
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 20%, var(--surface)),
			color-mix(in srgb, var(--rose) 12%, var(--surface))
		);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	h1 {
		margin: 0 0 4px;
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1.15;
	}
	.hero p {
		margin: 0;
		font-size: 14px;
		color: var(--accents-5);
		max-width: 60ch;
		line-height: 1.55;
	}

	.banner {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 10px 14px;
		font-size: 13px;
		border-radius: var(--radius-md);
	}
	.banner.error {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.06);
		border: 1px solid rgba(238, 0, 0, 0.3);
	}

	.tabs {
		display: inline-flex;
		gap: 2px;
		padding: 4px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		width: fit-content;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 120ms;
	}
	.tab:hover {
		color: var(--geist-foreground);
	}
	.tab.active {
		color: var(--geist-foreground);
		background: var(--surface);
		box-shadow: var(--shadow-smallest);
	}
	.tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 18px;
		padding: 0 6px;
		font-size: 10px;
		font-weight: 500;
		color: var(--accents-6);
		background: var(--accents-2);
		border-radius: var(--radius-pill);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 22px 22px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.card-head h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.card-head p {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--accents-5);
	}
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 18px;
		padding: 0 6px;
		font-size: 11px;
		font-weight: 500;
		color: var(--accents-6);
		background: var(--accents-2);
		border-radius: var(--radius-pill);
	}

	.card-form {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.invite-form {
		gap: 8px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 200px;
		flex: 1;
	}
	.field.grow {
		flex: 2;
	}
	.field.narrow {
		flex: 0 1 130px;
		min-width: 0;
	}
	.field-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-5);
	}
	.field-label em {
		font-style: normal;
		color: var(--accents-4);
	}
	.field-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}
	.field-icon {
		position: absolute;
		left: 12px;
		display: inline-flex;
		color: var(--accents-4);
	}
	.field input {
		width: 100%;
		height: 36px;
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
	.field-wrap input {
		padding-left: 36px;
	}
	.field input:focus {
		border-color: var(--geist-foreground);
	}
	.checkbox {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--accents-6);
		padding: 0 4px;
		height: 36px;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 36px;
		padding: 0 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		border: 1px solid;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 120ms;
		white-space: nowrap;
	}
	.btn.primary {
		color: var(--geist-background);
		background: var(--geist-foreground);
		border-color: var(--geist-foreground);
	}
	.btn.primary:hover {
		opacity: 0.9;
	}
	.btn.ghost {
		color: var(--accents-6);
		background: transparent;
		border-color: var(--border);
		height: 30px;
		padding: 0 10px;
		font-size: 12px;
	}
	.btn.ghost:hover {
		color: var(--geist-foreground);
		border-color: var(--accents-3);
	}
	.btn.ghost.danger:hover {
		color: var(--geist-error);
		border-color: rgba(238, 0, 0, 0.4);
	}

	.data-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.data-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition: border-color 120ms;
	}
	.data-row:hover {
		border-color: var(--accents-3);
	}
	.row-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}
	.row-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.row-title {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 500;
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-sub {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--accents-5);
		font-family: var(--font-sans);
	}
	.dot-sep {
		color: var(--accents-3);
	}
	.token {
		font-family: var(--font-mono);
	}
	.status-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.status-dot.on {
		background: var(--geist-success);
		box-shadow: 0 0 0 2px rgba(0, 112, 243, 0.18);
	}
	.status-dot.off {
		background: var(--accents-3);
	}

	.role-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 9px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition: opacity 100ms;
	}
	.role-pill.admin {
		color: var(--geist-success);
		background: rgba(0, 112, 243, 0.08);
		border-color: rgba(0, 112, 243, 0.3);
	}
	.role-pill:hover {
		opacity: 0.8;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: var(--radius-pill);
	}
	.badge.admin {
		color: var(--geist-success);
		background: rgba(0, 112, 243, 0.1);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 24px;
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

	.inline-form {
		display: inline;
	}
</style>
