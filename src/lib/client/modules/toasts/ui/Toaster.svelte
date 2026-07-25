<script lang="ts">
	import { browser } from '$app/environment';
	import { fly } from 'svelte/transition';
	import type { Attachment } from 'svelte/attachments';
	import Icon from '$lib/client/components/Icon.svelte';
	import { toasts, type Toast } from '../store.svelte';

	/**
	 * In-house toast card. Replaced the library Toast: its close affordance
	 * needed URL-based icons (incompatible with the inline-SVG icon system),
	 * its positioning/animation internals fought the wrapper, and it couldn't
	 * cap the stack. The editorial solid fills stay — they come from the
	 * .ms-toast-* variant classes in theme.css.
	 */
	const MAX_VISIBLE = 3;
	const visible = $derived(toasts.items.slice(-MAX_VISIBLE));
	const overflow = $derived(Math.max(0, toasts.items.length - MAX_VISIBLE));

	const reduceMotion = browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function autoDismiss(toast: Toast): Attachment {
		return () => {
			if (toast.duration <= 0) {
				return () => {};
			}
			const t = setTimeout(() => toasts.dismiss(toast.id), toast.duration);
			return () => clearTimeout(t);
		};
	}
</script>

<div class="toaster" aria-live="polite">
	{#if overflow > 0}
		<span class="toast-overflow">+{overflow} more</span>
	{/if}
	{#each visible as toast (toast.id)}
		<div
			class="toast ms-toast-{toast.kind}"
			role={toast.kind === 'error' ? 'alert' : 'status'}
			transition:fly={{ y: 10, duration: reduceMotion ? 0 : 160 }}
			{@attach autoDismiss(toast)}
		>
			<div class="toast-body">
				<span class="toast-title">{toast.title}</span>
				{#if toast.description}
					<span class="toast-desc">{toast.description}</span>
				{/if}
				{#if toast.action}
					{@const action = toast.action}
					<button
						type="button"
						class="toast-action"
						onclick={() => {
							action.onClick();
							toasts.dismiss(toast.id);
						}}
					>
						{action.label}
					</button>
				{/if}
			</div>
			<button
				type="button"
				class="toast-close"
				aria-label="Dismiss notification"
				onclick={() => toasts.dismiss(toast.id)}
			>
				<Icon name="x" size={12} />
			</button>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		bottom: 16px;
		right: 16px;
		z-index: 300;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		width: min(360px, calc(100vw - 32px));
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		padding: 11px 12px 11px 14px;
		color: #ffffff;
		background: var(--toast-background-color, #2a2c34);
		border-radius: var(--radius);
		box-shadow: 0 16px 32px -12px rgba(0, 0, 0, 0.5);
		pointer-events: auto;
	}

	.toast-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.toast-title {
		font-size: 13px;
		font-weight: 600;
		line-height: 1.4;
	}
	.toast-desc {
		font-size: 12px;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.78);
	}

	.toast-action {
		align-self: flex-start;
		margin-top: 4px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #ffffff;
		background: rgba(255, 255, 255, 0.16);
		border: 1px solid rgba(255, 255, 255, 0.28);
		padding: 3px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 120ms;
	}
	.toast-action:hover {
		background: rgba(255, 255, 255, 0.26);
	}

	.toast-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		padding: 0;
		font: inherit;
		color: rgba(255, 255, 255, 0.65);
		background: transparent;
		border: none;
		border-radius: 5px;
		cursor: pointer;
		transition:
			color 120ms,
			background 120ms;
	}
	.toast-close:hover {
		color: #ffffff;
		background: rgba(255, 255, 255, 0.14);
	}

	.toast-overflow {
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 2px 9px;
		pointer-events: auto;
	}
</style>
