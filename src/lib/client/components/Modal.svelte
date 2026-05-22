<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from './Icon.svelte';
	import type { Snippet } from 'svelte';

	type Props = {
		open: boolean;
		title?: string;
		description?: string;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
		size?: 'sm' | 'md' | 'lg';
	};

	let {
		open,
		title,
		description,
		onClose,
		children,
		footer,
		size = 'sm'
	}: Props = $props();

	type ModalParams = { active: boolean; close: () => void };

	function modalEffects(_node: HTMLElement, params: ModalParams) {
		let active = params.active;
		let close = params.close;

		function handleKey(e: KeyboardEvent) {
			if (e.key === 'Escape' && active) {
				close();
			}
		}

		function setLock(locked: boolean) {
			if (typeof document === 'undefined') {
				return;
			}
			document.body.style.overflow = locked ? 'hidden' : '';
		}

		setLock(active);
		window.addEventListener('keydown', handleKey);

		return {
			update(next: ModalParams) {
				active = next.active;
				close = next.close;
				setLock(active);
			},
			destroy() {
				window.removeEventListener('keydown', handleKey);
				setLock(false);
			}
		};
	}

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.body.style.overflow = '';
		}
	});
</script>

{#if open}
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-label={title ?? 'Dialog'}
		tabindex="-1"
		use:modalEffects={{ active: open, close: onClose }}
		onmousedown={(e) => {
			if (e.target === e.currentTarget) {
				onClose();
			}
		}}
		transition:fade={{ duration: 140 }}
	>
		<div
			class="modal {size}"
			transition:scale={{ duration: 180, start: 0.96, easing: cubicOut }}
		>
			{#if title}
				<header class="head">
					<div class="head-text">
						<h3>{title}</h3>
						{#if description}
							<p class="desc">{description}</p>
						{/if}
					</div>
					<button class="close" type="button" onclick={onClose} aria-label="Close">
						<Icon name="x" size={16} />
					</button>
				</header>
			{/if}

			<div class="body">{@render children()}</div>

			{#if footer}
				<footer class="foot">{@render footer()}</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: color-mix(in srgb, var(--geist-foreground) 24%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.modal {
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow:
			0 1px 0 0 color-mix(in srgb, var(--geist-foreground) 10%, transparent) inset,
			0 30px 80px -20px rgba(0, 0, 0, 0.4),
			0 16px 40px -16px rgba(0, 0, 0, 0.3);
		overflow: hidden;
	}
	.modal.md {
		max-width: 560px;
	}
	.modal.lg {
		max-width: 720px;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px 12px;
	}
	.head-text {
		min-width: 0;
	}
	.head h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.desc {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--accents-5);
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		font: inherit;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.close:hover {
		color: var(--geist-foreground);
		background: var(--accents-1);
	}

	.body {
		padding: 8px 20px 20px;
	}

	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px 16px;
		border-top: 1px solid var(--border);
		background: var(--accents-1);
	}
</style>
