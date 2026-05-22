<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from '$lib/client/components/Icon.svelte';
	import { toasts } from '../store.svelte';
	import type { IconName } from '$lib/client/components/Icon.svelte';

	const ICON_FOR_KIND: Record<'success' | 'error' | 'info', IconName> = {
		success: 'check',
		error: 'alert-circle',
		info: 'info-circle'
	};
</script>

<div class="toaster" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<output
			class="toast {toast.kind}"
			in:fly={{ y: 12, duration: 220, easing: cubicOut }}
			out:fade={{ duration: 160 }}
		>
			<span class="ico">
				<Icon name={ICON_FOR_KIND[toast.kind]} size={15} />
			</span>
			<div class="body">
				<div class="title">{toast.title}</div>
				{#if toast.description}
					<div class="desc">{toast.description}</div>
				{/if}
			</div>
			{#if toast.action}
				<button
					type="button"
					class="action"
					onclick={() => {
						if (toast.action) {
							toast.action.onClick();
						}
						toasts.dismiss(toast.id);
					}}
				>
					{toast.action.label}
				</button>
			{/if}
			<button
				type="button"
				class="close"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(toast.id)}
			>
				<Icon name="x" size={12} />
			</button>
		</output>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		bottom: 16px;
		right: 16px;
		z-index: 300;
		display: flex;
		flex-direction: column-reverse;
		gap: 8px;
		max-width: min(360px, calc(100vw - 32px));
		pointer-events: none;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px 10px 14px;
		background: color-mix(in srgb, var(--surface) 92%, var(--accents-1) 8%);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow:
			0 1px 0 0 color-mix(in srgb, var(--geist-foreground) 6%, transparent) inset,
			0 16px 32px -12px rgba(0, 0, 0, 0.5),
			0 4px 8px -4px rgba(0, 0, 0, 0.3);
		font-size: 13px;
		color: var(--geist-foreground);
		min-width: 240px;
	}

	.ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		border-radius: 50%;
	}
	.toast.success .ico {
		color: var(--geist-success);
		background: rgba(0, 112, 243, 0.1);
	}
	.toast.error .ico {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.1);
	}
	.toast.info .ico {
		color: var(--accents-6);
		background: var(--accents-1);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.title {
		font-weight: 500;
		line-height: 1.35;
	}
	.desc {
		font-size: 12px;
		color: var(--accents-5);
		line-height: 1.4;
	}

	.action {
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--border);
		padding: 4px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: border-color 120ms;
	}
	.action:hover {
		border-color: var(--accents-3);
	}

	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}
	.close:hover {
		color: var(--geist-foreground);
		background: var(--accents-1);
	}
</style>
