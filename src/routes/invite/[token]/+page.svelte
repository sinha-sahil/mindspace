<script lang="ts">
	import Logo from '$lib/client/components/Logo.svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import MeshBackground from '$lib/client/components/MeshBackground.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let email = $state('');
</script>

<MeshBackground variant="subtle" />

<main>
	<div class="card">
		<a href="/" class="brand">
			<Logo size={22} />
			<span>mindspace</span>
		</a>

		{#if !data.valid}
			<div class="state">
				<div class="icon error">
					<Icon name="x" size={20} />
				</div>
				<h1>Link unavailable</h1>
				<p>{data.reason}</p>
				<a href="/auth/login" class="btn secondary">
					<Icon name="arrow-up-right" size={14} />
					<span>Already a member? Sign in</span>
				</a>
			</div>
		{:else}
			<div class="state">
				<div class="icon ok">
					<Icon name="sparkles" size={20} />
				</div>
				<h1>You're invited</h1>
				{#if data.workspaceName}
					<div class="note">
						Join the “{data.workspaceName}” workspace{data.workspaceRole === 'viewer'
							? ' as a viewer'
							: ''}
					</div>
				{:else if data.note}
					<div class="note">"{data.note}"</div>
				{/if}
				<p>Add your email to claim this invite. We'll send a magic link so you can sign in.</p>
				{#if data.grantsAdmin}
					<div class="badge">
						<Icon name="shield" size={12} />
						<span>This invite grants admin access</span>
					</div>
				{/if}

				<form method="POST" use:enhance>
					<label class="field">
						<span class="field-label">Your email</span>
						<div class="field-wrap">
							<span class="field-icon"><Icon name="mail" size={14} /></span>
							<input
								type="email"
								name="email"
								bind:value={email}
								required
								placeholder="you@example.com"
								autocomplete="email"
							/>
						</div>
					</label>
					<button type="submit" class="btn primary">
						<Icon name="check" size={14} />
						<span>Accept invite</span>
					</button>
					{#if form?.message}
						<p class="error">{form.message}</p>
					{/if}
				</form>
			</div>
		{/if}
	</div>
</main>

<style>
	main {
		position: relative;
		z-index: 1;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.card {
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 32px;
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		border: 1px solid var(--border);
		border-radius: 14px;
		backdrop-filter: blur(20px) saturate(140%);
		-webkit-backdrop-filter: blur(20px) saturate(140%);
		box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.45);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: var(--geist-foreground);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.state {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
	}
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: var(--radius-md);
	}
	.icon.ok {
		color: var(--geist-success);
		background: rgba(0, 112, 243, 0.1);
		border: 1px solid rgba(0, 112, 243, 0.3);
	}
	.icon.error {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
		border: 1px solid rgba(238, 0, 0, 0.3);
	}
	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.025em;
	}
	.note {
		font-size: 13px;
		font-style: italic;
		color: var(--geist-foreground);
		padding: 8px 12px;
		background: var(--accents-1);
		border-left: 3px solid var(--geist-foreground);
		border-radius: var(--radius-sm);
		align-self: stretch;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: var(--accents-5);
		line-height: 1.5;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 500;
		color: var(--geist-success);
		background: rgba(0, 112, 243, 0.08);
		border: 1px solid rgba(0, 112, 243, 0.3);
		border-radius: var(--radius-pill);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-self: stretch;
		margin-top: 4px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-5);
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
		height: 38px;
		padding: 0 12px 0 36px;
		font: inherit;
		font-size: 14px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		outline: none;
		transition: border-color 120ms;
	}
	.field input:focus {
		border-color: var(--geist-foreground);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 38px;
		padding: 0 16px;
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		border: 1px solid;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.btn.primary {
		color: var(--geist-background);
		background: var(--geist-foreground);
		border-color: var(--geist-foreground);
	}
	.btn.primary:hover {
		opacity: 0.9;
	}
	.btn.secondary {
		color: var(--geist-foreground);
		background: transparent;
		border-color: var(--border);
		align-self: flex-start;
	}
	.btn.secondary:hover {
		border-color: var(--accents-3);
		background: var(--accents-1);
	}
	.error {
		margin: 0;
		font-size: 12px;
		color: var(--geist-error);
	}
</style>
