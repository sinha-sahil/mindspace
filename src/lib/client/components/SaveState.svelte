<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	/**
	 * The one save indicator (docs/design.md): transient chrome only.
	 * Shows "Saving…" while a write is in flight, flashes "Saved" for a
	 * moment once it lands, then renders nothing — a permanent status dot
	 * is noise. Failures are the toast layer's job.
	 */
	type Props = { saving: boolean };
	let { saving }: Props = $props();

	let showSaved = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let sawSaving = false;

	// Attachment instead of $effect (house rule): re-runs when `saving` flips.
	const track: Attachment = () => {
		if (saving) {
			sawSaving = true;
			showSaved = false;
		} else if (sawSaving) {
			sawSaving = false;
			showSaved = true;
			timer = setTimeout(() => {
				showSaved = false;
				timer = null;
			}, 1800);
		}
		return () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		};
	};
</script>

<span class="save-state" {@attach track} aria-live="polite">
	{#if saving}
		<span class="ss-dot saving" aria-hidden="true"></span><span>Saving…</span>
	{:else if showSaved}
		<span class="ss-dot" aria-hidden="true"></span><span>Saved</span>
	{/if}
</span>

<style>
	.save-state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
	}
	.ss-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--sage);
		flex-shrink: 0;
	}
	.ss-dot.saving {
		background: var(--saffron);
		animation: ss-pulse 1.4s ease-in-out infinite;
	}
	@keyframes ss-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ss-dot.saving {
			animation: none;
		}
	}
</style>
