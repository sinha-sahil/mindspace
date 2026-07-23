<script lang="ts">
	import { Toast } from 'polymorph-ui-components';
	import { toasts } from '../store.svelte';
</script>

<div class="toaster" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<Toast
			classes="ms-toast ms-toast-{toast.kind}"
			message={toast.title}
			subtext={toast.description}
			duration={toast.duration}
			direction="bottom-to-top"
			overlapPage={false}
			ontoasthide={() => toasts.dismiss(toast.id)}
		>
			{#snippet bottomContent()}
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
			{/snippet}
		</Toast>
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
		width: min(360px, calc(100vw - 32px));
		pointer-events: none;
	}

	.toast-action {
		margin-top: 2px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #ffffff;
		background: rgba(255, 255, 255, 0.16);
		border: 1px solid rgba(255, 255, 255, 0.28);
		padding: 4px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: background 120ms;
	}
	.toast-action:hover {
		background: rgba(255, 255, 255, 0.26);
	}
</style>
