<script lang="ts">
	import { Modal, Button } from 'polymorph-ui-components';
	import Icon from '$lib/client/components/Icon.svelte';
	import { toasts } from '$lib/client/modules/toasts';

	/**
	 * Self-contained "Use mindspace from Claude Code" modal.
	 *
	 * One-click flow: pick global/local scope → click Generate → click Copy →
	 * paste in terminal. The token is minted inline (POST /api/api-tokens),
	 * shown once, and pre-baked into the install command for the active tab
	 * so the user never has to copy-paste the raw token into a placeholder.
	 *
	 * The Generate call uses cookie-auth (Bearer is rejected by the tokens
	 * endpoint), so this only works for signed-in users — which is fine,
	 * the modal is only reachable from the authenticated sidebar.
	 */

	let { open = $bindable(false) }: { open: boolean } = $props();

	type Scope = 'global' | 'local';

	let tokenName = $state(suggestName());
	let creating = $state(false);
	let createError = $state('');
	// The raw token is shown ONCE — captured here from the create response
	// and pre-filled into the command snippet. Cleared when the modal closes
	// so a subsequent open starts fresh.
	let raw = $state<string | null>(null);
	let tab = $state<Scope>('global');
	let copied = $state(false);

	const MCP_ENDPOINT = '/mcp';

	// Use the user's current origin so dev (localhost) and prod both work.
	// SSR-safe fallback to the canonical prod URL.
	const origin = $derived(
		typeof window === 'undefined' ? 'https://www.mindspace.casa' : window.location.origin
	);

	const tokenForCommand = $derived(raw ?? 'mind_paste_your_token_here');

	const commands = $derived({
		global: `claude mcp add --transport http --scope user mindspace ${origin}${MCP_ENDPOINT} \\
  --header "Authorization: Bearer ${tokenForCommand}"`,
		local: `claude mcp add --transport http mindspace ${origin}${MCP_ENDPOINT} \\
  --header "Authorization: Bearer ${tokenForCommand}"`
	});

	const activeCommand = $derived(commands[tab]);

	function suggestName(): string {
		const d = new Date();
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `Claude Code · ${yyyy}-${mm}-${dd}`;
	}

	function handleClose() {
		open = false;
		// Reset for next open. We keep `raw` discarded so it can't be
		// reopened-then-recovered — once dismissed, the user must re-generate.
		raw = null;
		createError = '';
		copied = false;
		tokenName = suggestName();
	}

	async function generate() {
		const name = tokenName.trim();
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
			const body: { raw: string } = await res.json();
			raw = body.raw;
			toasts.success('Token created', { description: 'Copy the command below' });
		} catch (e) {
			createError = e instanceof Error ? e.message : 'Could not create token';
		} finally {
			creating = false;
		}
	}

	async function copyCommand() {
		try {
			await navigator.clipboard.writeText(activeCommand);
			copied = true;
			toasts.success('Copied to clipboard');
			setTimeout(() => (copied = false), 1500);
		} catch {
			toasts.error('Couldn’t copy — clipboard blocked');
		}
	}
</script>

{#if open}
	<Modal
		classes="ms-modal"
		size="fit-content"
		header={{ text: 'Use mindspace from Claude Code' }}
		onoverlayclick={handleClose}
	>
		{#snippet content()}
			<div class="mcp-install">
				<p class="mcp-intro">
					Connect Claude Code (or any MCP-aware client) to mindspace so an LLM can browse your
					workspaces, create whiteboards from Excalidraw scenes, upload markdown documents, build
					spreadsheets with formulas, and read text-anchored comment threads. Nothing to install
					locally.
				</p>

				<!-- Scope tabs -->
				<div class="tabs" role="tablist" aria-label="Install scope">
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'global'}
						class="tab"
						class:active={tab === 'global'}
						onclick={() => (tab = 'global')}
					>
						<Icon name="globe" size={12} />
						<span>Global</span>
						<span class="tab-sub">all projects</span>
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'local'}
						class="tab"
						class:active={tab === 'local'}
						onclick={() => (tab = 'local')}
					>
						<Icon name="folder" size={12} />
						<span>Local</span>
						<span class="tab-sub">current directory</span>
					</button>
				</div>

				<!-- Token block -->
				{#if !raw}
					<div class="token-block">
						<label class="field">
							<span class="field-label">Token name</span>
							<input
								type="text"
								class="field-input"
								bind:value={tokenName}
								placeholder="Claude Code · MacBook"
								maxlength="80"
								disabled={creating}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										generate();
									}
								}}
							/>
						</label>
						<button
							type="button"
							class="generate-btn"
							onclick={generate}
							disabled={!tokenName.trim() || creating}
						>
							<Icon name="key" size={12} />
							<span>{creating ? 'Generating…' : 'Generate token & command'}</span>
						</button>
						{#if createError}
							<p class="error">{createError}</p>
						{/if}
					</div>
				{:else}
					<div class="reveal">
						<div class="reveal-head">
							<Icon name="alert-circle" size={13} />
							<span
								>Token <code>{raw.slice(0, 12)}…</code> created. The full value is in the command
								below — shown <strong>once</strong>.</span
							>
						</div>
					</div>
				{/if}

				<!-- Command -->
				<div class="cmd-block" class:cmd-block--ready={!!raw}>
					<div class="cmd-head">
						<span class="cmd-label">Run in your terminal</span>
						<button
							type="button"
							class="copy-btn"
							onclick={copyCommand}
							disabled={!raw}
							aria-label="Copy command"
						>
							<Icon name={copied ? 'check' : 'copy'} size={11} />
							<span>{copied ? 'Copied' : 'Copy'}</span>
						</button>
					</div>
					<pre class="cmd"><code>{activeCommand}</code></pre>
					{#if !raw}
						<p class="cmd-hint">Generate a token to fill in the bearer value.</p>
					{/if}
				</div>

				<p class="mcp-foot">
					Different client (Claude Desktop, Cursor, …)? Add an HTTP MCP entry pointing at
					<code>{origin}{MCP_ENDPOINT}</code> with header
					<code>Authorization: Bearer mind_…</code>. Manage tokens at
					<a href="/settings/api-tokens" onclick={handleClose}>Settings → API tokens</a>.
				</p>
			</div>
		{/snippet}
		{#snippet footerSnippet()}
			<Button text="Done" onclick={handleClose} />
		{/snippet}
	</Modal>
{/if}

<style>
	/* Styled with the project design tokens (theme.css): --bg / --bg-2 /
	   --surface / --surface-2, --fg / --fg-2 / --muted, --accent, --rose /
	   --saffron, --radius-*, --shadow-*, --duration-* / --ease-*. Nested
	   panels deliberately step UP one elevation level (surface → surface-2)
	   so they don't disappear into the modal's --surface background. */

	.mcp-install {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px 22px 20px;
		width: min(560px, 92vw);
	}

	.mcp-intro {
		margin: 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--fg-2);
	}

	/* --- tabs --------------------------------------------------------- */
	.tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3px;
		padding: 3px;
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.tab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 10px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out);
	}
	.tab:hover:not(.active) {
		color: var(--fg-2);
		background: color-mix(in srgb, var(--surface) 50%, transparent);
	}
	.tab.active {
		color: var(--fg);
		background: var(--surface-2);
		box-shadow: var(--shadow-sm);
	}
	.tab-sub {
		font-size: 11px;
		font-weight: 400;
		color: var(--muted-2);
	}
	.tab.active .tab-sub {
		color: var(--muted);
	}

	/* --- token block (before generation) ------------------------------ */
	.token-block {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field-label {
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.field-input {
		height: 34px;
		padding: 0 11px;
		font: inherit;
		font-size: 13px;
		color: var(--fg);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		outline: none;
		transition:
			border-color var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out);
	}
	.field-input::placeholder {
		color: var(--muted-2);
	}
	.field-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.field-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.generate-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 9px 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		color: #fff;
		background: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		cursor: pointer;
		box-shadow: var(--shadow-sm);
		transition:
			background var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.generate-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 88%, #fff);
		box-shadow:
			0 0 0 4px var(--accent-soft),
			var(--shadow-sm);
	}
	.generate-btn:active:not(:disabled) {
		transform: translateY(0.5px);
	}
	.generate-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.error {
		margin: 0;
		font-size: 12px;
		color: var(--rose);
	}

	/* --- token reveal banner (after generation) ----------------------- */
	.reveal {
		padding: 10px 12px;
		background: color-mix(in srgb, var(--saffron) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--saffron) 35%, transparent);
		border-radius: var(--radius-sm);
	}
	.reveal-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--fg-2);
	}
	.reveal-head code {
		font-family: var(--font-mono);
		font-size: 11.5px;
		padding: 1px 6px;
		color: var(--fg);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.reveal-head strong {
		color: var(--saffron);
		font-weight: 600;
	}

	/* --- command block ------------------------------------------------ */
	.cmd-block {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 16px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		opacity: 0.65;
		transition: opacity var(--duration) var(--ease-out);
	}
	.cmd-block--ready {
		opacity: 1;
	}
	.cmd-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.cmd-label {
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.copy-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font: inherit;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--fg-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out),
			background var(--duration-fast) var(--ease-out);
	}
	.copy-btn:hover:not(:disabled) {
		color: var(--fg);
		border-color: var(--border-strong);
		background: var(--surface-2);
	}
	.copy-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.cmd {
		margin: 0;
		padding: 11px 13px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 1.55;
		color: var(--fg);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		overflow-x: auto;
		white-space: pre;
	}
	.cmd code {
		font-family: inherit;
		font-size: inherit;
		background: transparent;
		border: none;
		padding: 0;
	}
	.cmd-hint {
		margin: 0;
		font-size: 11.5px;
		color: var(--muted);
	}

	/* --- footer note -------------------------------------------------- */
	.mcp-foot {
		margin: 2px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		line-height: 1.6;
		color: var(--muted);
	}
	.mcp-foot code {
		font-family: var(--font-mono);
		font-size: 10.5px;
		padding: 1px 5px;
		color: var(--fg-2);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.mcp-foot a {
		color: var(--accent);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		transition: border-color var(--duration-fast) var(--ease-out);
	}
	.mcp-foot a:hover {
		border-bottom-color: var(--accent);
	}
</style>
