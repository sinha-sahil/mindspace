<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Logo from '$lib/client/components/Logo.svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { toasts } from '$lib/client/modules/toasts';
	import { formatDate } from '$lib/client/utils/format';

	let { data } = $props();

	let creating = $state(false);
	let createOpen = $state(false);
	let nameDraft = $state('');
	let createError = $state('');

	// When set, the raw token has just been minted — show it once with a
	// copy button. Cleared when the user dismisses the banner.
	let newToken = $state<{ name: string; raw: string; prefix: string } | null>(null);
	let copied = $state(false);

	function openCreate() {
		nameDraft = '';
		createError = '';
		createOpen = true;
		queueMicrotask(() => {
			document.querySelector<HTMLInputElement>('.create-input')?.focus();
		});
	}

	async function createToken() {
		const name = nameDraft.trim();
		if (!name || creating) {
			return;
		}
		creating = true;
		createError = '';
		try {
			const res = await fetch('/api/api-tokens', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			const body: { name: string; raw: string; token_prefix: string } = await res.json();
			newToken = { name: body.name, raw: body.raw, prefix: body.token_prefix };
			createOpen = false;
			nameDraft = '';
			await invalidateAll();
		} catch (e) {
			createError = e instanceof Error ? e.message : 'Could not create token';
		} finally {
			creating = false;
		}
	}

	async function copyRaw() {
		if (!newToken) {
			return;
		}
		try {
			await navigator.clipboard.writeText(newToken.raw);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			toasts.error('Couldn’t copy — clipboard blocked');
		}
	}

	async function revoke(id: string, name: string) {
		if (!confirm(`Revoke "${name}"? Any client using it will lose access immediately.`)) {
			return;
		}
		const res = await fetch(`/api/api-tokens/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toasts.info('Token revoked', { description: name });
			await invalidateAll();
		} else {
			toasts.error('Could not revoke');
		}
	}
</script>

<svelte:head>
	<title>API tokens · mindspace</title>
</svelte:head>

<div class="page">
	<header class="topbar">
		<a href="/" class="brand">
			<Logo size={20} />
			<span>mindspace</span>
		</a>
		<nav class="tabs">
			<a href="/settings/passkeys" class="tab">Passkeys</a>
			<a href="/settings/api-tokens" class="tab active">API tokens</a>
		</nav>
	</header>

	<main class="main">
		<header class="head">
			<div>
				<h1>API tokens</h1>
				<p class="sub">
					Long-lived tokens for programmatic access (the MCP server, scripts, CI). Each token acts
					as <strong>{data.userEmail}</strong>.
				</p>
			</div>
			<button type="button" class="btn primary" onclick={openCreate}>
				<Icon name="plus" size={13} />
				<span>New token</span>
			</button>
		</header>

		{#if newToken}
			<section class="reveal">
				<div class="reveal-head">
					<Icon name="key" size={14} />
					<span class="reveal-title">Token created — copy it now</span>
					<button class="reveal-dismiss" onclick={() => (newToken = null)} aria-label="Dismiss">
						<Icon name="x" size={13} />
					</button>
				</div>
				<p class="reveal-warn">
					This is the only time the raw value will be shown. Store it somewhere safe — we only keep
					its hash.
				</p>
				<div class="reveal-row">
					<code class="reveal-code">{newToken.raw}</code>
					<button class="btn" onclick={copyRaw}>
						<Icon name={copied ? 'check' : 'copy'} size={12} />
						<span>{copied ? 'Copied' : 'Copy'}</span>
					</button>
				</div>
			</section>
		{/if}

		{#if createOpen}
			<section class="card">
				<h2>Create a new token</h2>
				<label class="field">
					<span>Name</span>
					<input
						class="create-input"
						type="text"
						bind:value={nameDraft}
						placeholder="e.g. Claude Code on laptop"
						maxlength="80"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								createToken();
							} else if (e.key === 'Escape') {
								createOpen = false;
							}
						}}
					/>
				</label>
				{#if createError}
					<p class="error">{createError}</p>
				{/if}
				<div class="actions">
					<button type="button" class="btn ghost" onclick={() => (createOpen = false)}
						>Cancel</button
					>
					<button
						type="button"
						class="btn primary"
						onclick={createToken}
						disabled={!nameDraft.trim() || creating}
					>
						{creating ? 'Creating…' : 'Create token'}
					</button>
				</div>
			</section>
		{/if}

		{#if data.tokens.length === 0}
			<div class="empty">
				<p>No tokens yet.</p>
				<p class="hint">Create one to use the mindspace MCP server with Claude Code.</p>
			</div>
		{:else}
			<ul class="token-list">
				{#each data.tokens as t (t.id)}
					<li class="token">
						<div class="t-head">
							<span class="t-name">{t.name}</span>
							<code class="t-prefix">{t.token_prefix}…</code>
						</div>
						<div class="t-meta">
							<span>Created {formatDate(new Date(t.created_at).getTime())}</span>
							{#if t.last_used_at}
								<span>· Last used {formatDate(new Date(t.last_used_at).getTime())}</span>
							{:else}
								<span>· Never used</span>
							{/if}
							{#if t.expires_at}
								<span>· Expires {formatDate(new Date(t.expires_at).getTime())}</span>
							{/if}
						</div>
						<button
							type="button"
							class="t-revoke"
							onclick={() => revoke(t.id, t.name)}
							aria-label="Revoke {t.name}"
						>
							<Icon name="trash" size={12} />
							<span>Revoke</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<section class="docs">
			<h2>Using a token</h2>
			<p>Pass the raw value as a Bearer header to any <code>/api/mcp/*</code> endpoint:</p>
			<pre><code
					>curl -H "Authorization: Bearer mind_…" \
     https://www.mindspace.casa/api/mcp/workspaces</code
				></pre>
			<p>
				The mindspace MCP server reads it from the <code>MINDSPACE_API_TOKEN</code> env var. See the
				README in the <code>mcp/</code> directory for the Claude Code install snippet.
			</p>
		</section>
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--bg);
		color: var(--fg);
		display: flex;
		flex-direction: column;
	}
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 24px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: var(--fg);
		text-decoration: none;
	}
	.tabs {
		display: flex;
		gap: 4px;
	}
	.tab {
		padding: 5px 12px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--accents-5);
		text-decoration: none;
		border-radius: 6px;
	}
	.tab:hover {
		color: var(--fg);
		background: var(--accents-1);
	}
	.tab.active {
		color: var(--fg);
		background: var(--accents-1);
	}

	.main {
		flex: 1;
		max-width: 760px;
		width: 100%;
		margin: 0 auto;
		padding: 40px 24px 80px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.head h1 {
		margin: 0 0 4px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 0;
		font-size: 13px;
		color: var(--accents-5);
		max-width: 460px;
	}
	.sub strong {
		color: var(--fg);
		font-weight: 600;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--fg);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		transition:
			border-color 120ms,
			background 120ms;
	}
	.btn:hover:not(:disabled) {
		border-color: var(--accents-3);
		background: var(--accents-1);
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
		opacity: 0.92;
		background: var(--fg);
	}
	.btn.ghost {
		color: var(--accents-5);
		border-color: var(--border);
	}

	.reveal {
		padding: 14px 16px;
		background: rgba(245, 165, 36, 0.08);
		border: 1px solid rgba(245, 165, 36, 0.3);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.reveal-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
	}
	.reveal-title {
		flex: 1;
	}
	.reveal-dismiss {
		color: var(--accents-5);
		background: transparent;
		border: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
	.reveal-warn {
		margin: 0;
		font-size: 12px;
		color: var(--accents-6);
	}
	.reveal-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.reveal-code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		padding: 8px 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		white-space: nowrap;
	}

	.card {
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.card h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field span {
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accents-5);
	}
	.field input {
		height: 34px;
		padding: 0 10px;
		font: inherit;
		font-size: 13px;
		color: var(--fg);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 7px;
		outline: none;
	}
	.field input:focus {
		border-color: var(--accent, var(--fg));
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}

	.empty {
		padding: 36px 16px;
		text-align: center;
		border: 1px dashed var(--border);
		border-radius: 10px;
		color: var(--accents-5);
	}
	.empty p {
		margin: 4px 0;
		font-size: 13px;
	}
	.empty .hint {
		font-size: 12px;
	}

	.token-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.token {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		position: relative;
	}
	.t-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.t-name {
		font-size: 13px;
		font-weight: 600;
	}
	.t-prefix {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--accents-5);
		padding: 1px 6px;
		background: var(--accents-1);
		border-radius: 4px;
	}
	.t-meta {
		display: flex;
		gap: 6px;
		font-size: 11.5px;
		color: var(--accents-5);
		flex-wrap: wrap;
	}
	.t-revoke {
		position: absolute;
		top: 12px;
		right: 12px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 9px;
		font: inherit;
		font-size: 11.5px;
		color: var(--accents-5);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 5px;
		cursor: pointer;
	}
	.t-revoke:hover {
		color: var(--geist-error);
		border-color: rgba(238, 0, 0, 0.3);
		background: rgba(238, 0, 0, 0.06);
	}

	.docs {
		padding: 18px 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.docs h2 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 600;
	}
	.docs p {
		margin: 6px 0;
		font-size: 12.5px;
		color: var(--accents-6);
	}
	.docs code {
		font-family: var(--font-mono);
		font-size: 11.5px;
		padding: 1px 5px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.docs pre {
		font-family: var(--font-mono);
		font-size: 11.5px;
		padding: 10px 12px;
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow-x: auto;
		margin: 8px 0;
	}
	.docs pre code {
		padding: 0;
		background: transparent;
		border: none;
	}

	.error {
		margin: 0;
		font-size: 12px;
		color: var(--geist-error);
	}
</style>
