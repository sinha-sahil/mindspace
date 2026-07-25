<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import Logo from '$lib/client/components/Logo.svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { isSupported, registerPasskey } from '$lib/client/modules/passkeys';
	import { formatDate as fmtDate } from '$lib/client/utils/format';
	import { onMount } from 'svelte';

	let { data, form } = $props();

	let supported = $state(false);
	let registering = $state(false);
	let regError = $state('');
	let deviceName = $state('');

	const forced = $derived(data.forced && data.passkeys.length === 0);

	onMount(() => {
		supported = isSupported();
	});

	async function handleRegister(e: SubmitEvent) {
		e.preventDefault();
		registering = true;
		regError = '';
		try {
			const label = deviceName.trim();
			await registerPasskey(label.length > 0 ? label : null);
			deviceName = '';
			await invalidateAll();
			if (data.forced) {
				await goto('/');
			}
		} catch (err) {
			regError = err instanceof Error ? err.message : 'Registration failed';
		} finally {
			registering = false;
		}
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
			<span class="crumb">Settings</span>
			<Icon name="chevron-right" size={12} class="crumb-sep" />
			<span class="crumb current">Passkeys</span>
		</div>
		{#if !forced}
			<a href="/" class="back-link">
				<Icon name="arrow-up-right" size={13} />
				<span>Back to app</span>
			</a>
		{:else}
			<form method="POST" action="/auth/logout" class="inline-form">
				<button type="submit" class="back-link danger">
					<Icon name="logout" size={13} />
					<span>Sign out</span>
				</button>
			</form>
		{/if}
	</header>

	<main>
		<section class="hero">
			<div class="hero-icon">
				<Icon name="fingerprint" size={20} />
			</div>
			<div>
				<h1>Passkeys</h1>
				<p>
					A passkey is a hardware-backed credential — Touch ID, Face ID, Windows Hello, or a
					security key. Sign in instantly, no passwords or magic-link emails.
				</p>
			</div>
		</section>

		{#if forced}
			<div class="banner warn">
				<Icon name="shield" size={16} />
				<div>
					<strong>Register a passkey to continue.</strong>
					<span>
						Mindspace requires every account to bind at least one passkey. After this, future
						sign-ins are instant — no email round-trip.
					</span>
				</div>
			</div>
		{/if}

		<section class="card">
			<header class="card-head">
				<h2>Add a passkey</h2>
				<p>Bind one passkey per device or browser. You can add as many as you like.</p>
			</header>

			{#if !supported}
				<div class="banner muted">
					<Icon name="x" size={16} />
					<div>
						<strong>WebAuthn unsupported.</strong>
						<span>Use a recent Chrome, Safari, Edge, or Firefox build.</span>
					</div>
				</div>
			{:else}
				<form onsubmit={handleRegister} class="card-form">
					<label class="field">
						<span class="field-label">Device label <em>(optional)</em></span>
						<div class="field-wrap">
							<span class="field-icon"><Icon name="key" size={14} /></span>
							<input
								bind:value={deviceName}
								type="text"
								placeholder="e.g. MacBook Touch ID"
								maxlength="60"
							/>
						</div>
					</label>
					<button type="submit" class="btn primary" disabled={registering}>
						<Icon name="plus" size={14} />
						<span>{registering ? 'Waiting for device…' : 'Register passkey'}</span>
					</button>
					{#if regError}
						<p class="error">{regError}</p>
					{/if}
				</form>
			{/if}
		</section>

		<section class="card">
			<header class="card-head">
				<h2>Your passkeys <span class="count">{data.passkeys.length}</span></h2>
				{#if form?.message}
					<p class="error">{form.message}</p>
				{/if}
			</header>

			{#if data.passkeys.length === 0}
				<div class="empty">
					<Icon name="key" size={20} class="empty-icon" />
					<p>No passkeys yet. Register one above to enable passkey sign-in.</p>
				</div>
			{:else}
				<ul class="passkey-list">
					{#each data.passkeys as pk (pk.credential_id)}
						<li class="passkey-row">
							<div class="pk-icon">
								<Icon name={pk.device_type === 'multiDevice' ? 'globe' : 'fingerprint'} size={16} />
							</div>
							<div class="pk-meta">
								<div class="pk-name">{pk.device_name || 'Unnamed passkey'}</div>
								<div class="pk-sub">
									<span class="tag">
										{pk.device_type === 'multiDevice' ? 'Synced' : 'Device-bound'}
									</span>
									{#if pk.backed_up}
										<span class="tag">Backed up</span>
									{/if}
									<span class="dot-sep">·</span>
									<span>Added {fmtDate(pk.created_at)}</span>
									<span class="dot-sep">·</span>
									<span>Last used {fmtDate(pk.last_used_at)}</span>
								</div>
							</div>
							<form method="POST" action="?/remove" use:enhance class="inline-form">
								<input type="hidden" name="credential_id" value={pk.credential_id} />
								<button type="submit" class="btn ghost danger">
									<Icon name="trash" size={13} />
									<span>Remove</span>
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--bg);
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
		color: var(--fg);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	:global(.crumb-sep) {
		color: var(--soft);
	}
	.crumb {
		font-size: 13px;
		color: var(--muted);
	}
	.crumb.current {
		color: var(--fg);
		font-weight: 500;
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 12px;
		color: var(--muted);
		text-decoration: none;
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.back-link:hover {
		color: var(--fg);
	}
	.back-link.danger:hover {
		color: var(--rose);
	}

	main {
		max-width: 760px;
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
		color: var(--fg);
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 20%, var(--surface)),
			color-mix(in srgb, var(--rose) 15%, var(--surface))
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
		color: var(--muted);
		max-width: 60ch;
		line-height: 1.55;
	}

	.banner {
		display: flex;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		font-size: 13px;
	}
	.banner > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.banner strong {
		font-weight: 600;
		color: var(--fg);
	}
	.banner span {
		color: var(--fg-2);
	}
	.banner.warn {
		color: var(--saffron);
		background: rgba(245, 166, 35, 0.08);
		border: 1px solid rgba(245, 166, 35, 0.35);
	}
	.banner.muted {
		color: var(--fg-2);
		background: var(--bg-2);
		border: 1px solid var(--border);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 22px 22px;
		background: var(--bg-2);
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
		color: var(--muted);
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
		color: var(--fg-2);
		background: var(--border);
		border-radius: var(--radius-pill);
	}

	.card-form {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field {
		flex: 1;
		min-width: 200px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
	}
	.field-label em {
		font-style: normal;
		color: var(--muted-2);
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
		color: var(--muted-2);
	}
	.field input {
		width: 100%;
		height: 36px;
		padding: 0 12px 0 36px;
		font: inherit;
		font-size: 14px;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		outline: none;
		transition: border-color 120ms;
	}
	.field input:focus {
		border-color: var(--fg);
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
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn.primary {
		color: var(--bg);
		background: var(--fg);
		border-color: var(--fg);
	}
	.btn.primary:hover:not(:disabled) {
		opacity: 0.9;
	}
	.btn.ghost {
		color: var(--fg-2);
		background: transparent;
		border-color: var(--border);
		height: 30px;
		padding: 0 10px;
		font-size: 12px;
	}
	.btn.ghost:hover {
		color: var(--fg);
		border-color: var(--soft);
	}
	.btn.ghost.danger:hover {
		color: var(--rose);
		border-color: rgba(238, 0, 0, 0.4);
	}

	.error {
		margin: 0;
		font-size: 12px;
		color: var(--rose);
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
		color: var(--muted-2);
	}
	.empty p {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}

	.passkey-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.passkey-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition: border-color 120ms;
	}
	.passkey-row:hover {
		border-color: var(--soft);
	}
	.pk-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		color: var(--fg);
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}
	.pk-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.pk-name {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pk-sub {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 11px;
		color: var(--muted);
	}
	.tag {
		display: inline-flex;
		padding: 1px 7px;
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--fg-2);
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}
	.dot-sep {
		color: var(--soft);
	}

	.inline-form {
		display: inline;
	}
</style>
