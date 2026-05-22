<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidate } from '$app/navigation';
	import Logo from '$lib/client/components/Logo.svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import MeshBackground from '$lib/client/components/MeshBackground.svelte';
	import { isSupported, loginWithPasskey } from '$lib/client/modules/passkeys';
	import { analytics } from '$lib/client/modules/analytics';
	import { onMount } from 'svelte';

	let { data } = $props();
	const { supabase } = $derived(data);

	let email = $state(page.url.searchParams.get('email') ?? '');
	let mode = $state<'idle' | 'sending' | 'sent' | 'error' | 'passkey-busy'>('idle');
	let errorMsg = $state('');
	let passkeySupported = $state(false);
	const justInvited = $derived(!!page.url.searchParams.get('email'));
	const errorParam = $derived(page.url.searchParams.get('error'));

	onMount(() => {
		passkeySupported = isSupported();
	});

	async function sendMagicLink(e: SubmitEvent) {
		e.preventDefault();
		if (!email.trim()) {
			return;
		}
		mode = 'sending';
		errorMsg = '';
		const { error } = await supabase.auth.signInWithOtp({
			email: email.trim(),
			options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
		});
		if (error) {
			mode = 'error';
			errorMsg = error.message;
		} else {
			mode = 'sent';
		}
	}

	async function signInWithPasskey() {
		mode = 'passkey-busy';
		errorMsg = '';
		try {
			const trimmed = email.trim();
			await loginWithPasskey(trimmed.length > 0 ? trimmed : null);
			await invalidate('supabase:auth');
			analytics.track('user_signed_in', { method: 'passkey' });
			await goto('/');
		} catch (err) {
			mode = 'error';
			errorMsg = err instanceof Error ? err.message : 'Passkey sign-in failed';
		}
	}
</script>

<MeshBackground />

<main class="page">
	<div class="frame">
		<header class="brand-row">
			<a href="/" class="brand">
				<span class="brand-mark">
					<Logo size={22} />
				</span>
				<span>mindspace</span>
			</a>
			<span class="dot-sep" aria-hidden="true">·</span>
			<span class="kicker">an invite-only thinking space</span>
		</header>

		<div class="grid">
			<section class="hero">
				<h1 class="display">
					A space for the<br />
					<span class="display-italic gradient-text">way you think.</span>
				</h1>
				<p class="lede">
					An infinite canvas, designed for the small group of people who actually have to make
					things together. Sketch, diagram, dump ideas — pick up exactly where you left off, on
					any device.
				</p>

				<ul class="features">
					<li>
						<span class="ft-ico"><Icon name="lock" size={14} /></span>
						<span>
							<strong>Invite-only.</strong>
							<em>Only emails on the allowlist can sign in.</em>
						</span>
					</li>
					<li>
						<span class="ft-ico"><Icon name="fingerprint" size={14} /></span>
						<span>
							<strong>Passkey-first.</strong>
							<em>Touch ID, Face ID, security keys — no passwords.</em>
						</span>
					</li>
					<li>
						<span class="ft-ico"><Icon name="link" size={14} /></span>
						<span>
							<strong>One-link sharing.</strong>
							<em>Flip a project to public; the URL is the invitation.</em>
						</span>
					</li>
				</ul>
			</section>

			<section class="auth-pane">
				<div class="card grainy">
					<div class="card-head">
						<h2 class="display">Welcome back.</h2>
						<p>Use your passkey or get a magic link.</p>
					</div>

					{#if justInvited && !errorParam}
						<div class="banner success">
							<Icon name="check" size={14} />
							<div>
								<strong>Invite accepted.</strong>
								<span>You're on the allowlist. Send yourself a magic link to finish.</span>
							</div>
						</div>
					{/if}

					{#if errorParam === 'not_authorized'}
						<div class="banner error">
							<Icon name="shield" size={14} />
							<div>
								<strong>Access denied.</strong>
								<span>Your email isn't on the allowlist. Ask the admin for an invite.</span>
							</div>
						</div>
					{:else if errorParam === 'invalid_code'}
						<div class="banner error">
							<Icon name="alert-circle" size={14} />
							<div>
								<strong>Link invalid or expired.</strong>
								<span>Request a new magic link below.</span>
							</div>
						</div>
					{/if}

					{#if mode === 'sent'}
						<div class="banner success">
							<Icon name="mail" size={14} />
							<div>
								<strong>Check your inbox.</strong>
								<span>A magic link has been sent to <code>{email}</code>.</span>
							</div>
						</div>
					{:else}
						<form onsubmit={sendMagicLink}>
							<label class="field">
								<span class="field-label">Email</span>
								<div class="field-wrap">
									<span class="field-icon"><Icon name="mail" size={14} /></span>
									<input
										type="email"
										bind:value={email}
										placeholder="you@example.com"
										autocomplete="email webauthn"
										required
									/>
								</div>
							</label>

							{#if passkeySupported}
								<button
									type="button"
									class="btn primary"
									disabled={mode === 'passkey-busy'}
									onclick={signInWithPasskey}
								>
									<Icon name="fingerprint" size={15} />
									{mode === 'passkey-busy' ? 'Waiting for your passkey…' : 'Continue with passkey'}
								</button>
								<div class="divider"><span>or</span></div>
							{/if}

							<button type="submit" class="btn ghost" disabled={mode === 'sending'}>
								<Icon name="mail" size={15} />
								{mode === 'sending' ? 'Sending…' : 'Send magic link'}
							</button>

							{#if mode === 'error'}
								<p class="error">{errorMsg}</p>
							{/if}
						</form>
					{/if}

					<p class="legal">No tracking. No ads. Just a quiet place to think.</p>
				</div>
			</section>
		</div>

		<footer class="foot">
			<span>© mindspace</span>
			<span class="dot-sep" aria-hidden="true">·</span>
			<span>made for slow, deliberate thinking</span>
		</footer>
	</div>
</main>

<style>
	.page {
		position: relative;
		z-index: 1;
		min-height: 100vh;
		display: flex;
		align-items: stretch;
	}

	.frame {
		position: relative;
		width: 100%;
		max-width: 1180px;
		margin: 0 auto;
		padding: 32px 40px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	@media (max-width: 760px) {
		.frame {
			padding: 24px 22px 40px;
		}
	}

	.brand-row {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--fg);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--fg);
		text-decoration: none;
	}
	.brand-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background:
			linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-sm);
		color: var(--fg);
	}
	.dot-sep {
		color: var(--soft);
	}
	.kicker {
		color: var(--muted);
		font-weight: 400;
		font-size: 12px;
	}

	.grid {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
		gap: 80px;
		align-items: center;
		padding: 24px 0;
	}
	@media (max-width: 980px) {
		.grid {
			grid-template-columns: 1fr;
			gap: 36px;
		}
	}

	/* ===================== HERO ===================== */
	.hero {
		display: flex;
		flex-direction: column;
		gap: 28px;
		max-width: 560px;
	}

	.hero h1 {
		margin: 0;
		font-size: clamp(40px, 6vw, 72px);
		line-height: 1;
		letter-spacing: -0.025em;
		color: var(--fg);
	}
	.hero h1 .gradient-text {
		font-style: italic;
		font-weight: 400;
		letter-spacing: -0.02em;
	}

	.lede {
		margin: 0;
		font-size: 16px;
		line-height: 1.6;
		color: var(--fg-2);
		max-width: 50ch;
	}

	.features {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.features li {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		font-size: 13.5px;
	}
	.features li > span:last-child {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.features strong {
		font-weight: 600;
		color: var(--fg);
	}
	.features em {
		font-style: normal;
		color: var(--muted);
	}
	.ft-ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: var(--shadow-sm);
	}

	/* ===================== AUTH CARD ===================== */
	.auth-pane {
		display: flex;
		justify-content: center;
	}

	.card {
		width: 100%;
		max-width: 420px;
		padding: 32px 30px 26px;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--surface) 92%, transparent) 0%,
				color-mix(in srgb, var(--surface) 78%, transparent) 100%
			);
		border: 1px solid var(--border);
		border-radius: 18px;
		backdrop-filter: blur(28px) saturate(140%);
		-webkit-backdrop-filter: blur(28px) saturate(140%);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.card-head h2 {
		margin: 0 0 4px;
		font-size: 26px;
		line-height: 1.1;
		letter-spacing: -0.02em;
		color: var(--fg);
	}
	.card-head p {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		position: relative;
		z-index: 1;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
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
		height: 40px;
		padding: 0 12px 0 36px;
		font: inherit;
		font-size: 14px;
		color: var(--fg);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		outline: none;
		transition:
			border-color 140ms,
			box-shadow 140ms;
	}
	.field input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 40px;
		padding: 0 16px;
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		border: 1px solid transparent;
		border-radius: 10px;
		cursor: pointer;
		transition:
			transform 120ms var(--ease-spring),
			box-shadow 200ms,
			background 200ms,
			border-color 200ms;
		position: relative;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.btn:not(:disabled):hover {
		transform: translateY(-1px);
	}
	.btn:not(:disabled):active {
		transform: translateY(0);
	}
	.btn.primary {
		color: #ffffff;
		background: var(--accent-gradient);
		background-size: 180% 100%;
		background-position: 0% 50%;
		border-color: transparent;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.05) inset,
			0 8px 24px -8px var(--accent-glow),
			0 1px 0 rgba(255, 255, 255, 0.2) inset;
		transition:
			background-position 800ms ease,
			transform 120ms var(--ease-spring),
			box-shadow 200ms;
	}
	.btn.primary:not(:disabled):hover {
		background-position: 100% 50%;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.08) inset,
			0 14px 32px -8px var(--accent-glow),
			0 1px 0 rgba(255, 255, 255, 0.25) inset;
	}
	.btn.ghost {
		color: var(--fg);
		background: var(--surface);
		border-color: var(--border);
	}
	.btn.ghost:not(:disabled):hover {
		background: var(--surface-2);
		border-color: var(--border-strong);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 2px 0;
		font-size: 11px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	.banner {
		display: flex;
		gap: 10px;
		padding: 11px 13px;
		font-size: 13px;
		border-radius: 10px;
		align-items: flex-start;
	}
	.banner :global(svg) {
		margin-top: 2px;
		flex-shrink: 0;
	}
	.banner > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.banner strong {
		font-weight: 600;
	}
	.banner.success {
		color: var(--accent);
		background: var(--accent-soft);
		border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
	}
	.banner.success span {
		color: var(--fg-2);
	}
	.banner.error {
		color: var(--rose);
		background: rgba(244, 114, 182, 0.1);
		border: 1px solid rgba(244, 114, 182, 0.3);
	}
	.banner.error span {
		color: var(--fg-2);
	}

	.error {
		margin: 0;
		font-size: 12px;
		color: var(--rose);
	}

	.legal {
		margin: 6px 0 0;
		font-size: 11px;
		color: var(--muted-2);
		text-align: center;
		font-style: italic;
		font-family: var(--font-display);
	}

	code {
		font-size: 12px;
		padding: 1px 6px;
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: 4px;
	}

	.foot {
		display: inline-flex;
		gap: 10px;
		align-items: center;
		font-size: 12px;
		color: var(--muted-2);
	}
</style>
