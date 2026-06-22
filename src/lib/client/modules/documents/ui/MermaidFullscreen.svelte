<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Icon from '$lib/client/components/Icon.svelte';
	import { MERMAID_FULLSCREEN_BTN_CLASS } from '../markdown';

	// A single overlay shared by every diagram on the page. It listens for
	// clicks on the per-diagram trigger buttons (injected as plain DOM by
	// renderMermaidDiagrams), grabs that diagram's SVG, and shows it enlarged
	// with zoom controls.
	let open = $state(false);
	let svgHtml = $state('');
	// `scale` is a multiplier over the fit-to-screen size, so 1 = "fits the
	// viewport" (what the user expects when opening fullscreen). Mermaid SVGs
	// render at a small intrinsic size, so we measure and fit on open rather
	// than showing them at that tiny natural size.
	let scale = $state(1);

	let stageEl: HTMLDivElement | null = $state(null);
	let diagramEl: HTMLDivElement | null = $state(null);
	// The fit-to-screen pixel size (scale = 1). Multiplied by `scale` to size
	// the real SVG element so the stage actually scrolls when zoomed in.
	let baseW = 0;
	let baseH = 0;

	const MIN_SCALE = 0.25;
	const MAX_SCALE = 8;
	const STEP = 0.25;
	const FIT_PADDING = 48; // breathing room around the fitted diagram, px

	function openWith(svg: SVGElement) {
		svgHtml = svg.outerHTML;
		scale = 1;
		open = true;
	}

	function close() {
		open = false;
		svgHtml = '';
		scale = 1;
		baseW = 0;
		baseH = 0;
	}

	/** Read the SVG's intrinsic aspect from its viewBox (mermaid always sets
	 *  one), falling back to its rendered box. */
	function svgIntrinsicSize(svg: SVGSVGElement): { w: number; h: number } {
		const vb = svg.viewBox?.baseVal;
		if (vb && vb.width > 0 && vb.height > 0) {
			return { w: vb.width, h: vb.height };
		}
		const r = svg.getBoundingClientRect();
		return { w: r.width || 1, h: r.height || 1 };
	}

	/** Compute the largest size that fits the stage, store it as the base, and
	 *  paint the current zoom. */
	function fitToStage() {
		if (!stageEl || !diagramEl) {
			return;
		}
		const svg = diagramEl.querySelector('svg');
		if (!(svg instanceof SVGSVGElement)) {
			return;
		}
		const { w, h } = svgIntrinsicSize(svg);
		const availW = Math.max(1, stageEl.clientWidth - FIT_PADDING * 2);
		const availH = Math.max(1, stageEl.clientHeight - FIT_PADDING * 2);
		const fit = Math.min(availW / w, availH / h);
		baseW = w * fit;
		baseH = h * fit;
		applySize();
	}

	/** Size the real SVG element to base × scale. Sizing the element (rather
	 *  than a CSS transform) means the stage's overflow becomes scrollable, so
	 *  the user can pan around a zoomed-in diagram. */
	function applySize() {
		const svg = diagramEl?.querySelector('svg');
		if (!(svg instanceof SVGSVGElement) || baseW === 0) {
			return;
		}
		svg.style.maxWidth = 'none';
		svg.style.maxHeight = 'none';
		svg.style.width = `${baseW * scale}px`;
		svg.style.height = `${baseH * scale}px`;
	}

	function zoom(delta: number) {
		scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((scale + delta) * 100) / 100));
		applySize();
	}

	function resetZoom() {
		scale = 1;
		// Recompute the fit too, in case the window was resized while zoomed.
		fitToStage();
	}

	function onBackdropClick(e: MouseEvent) {
		// Only the backdrop itself closes; clicks on the diagram/controls don't.
		if (e.target === e.currentTarget) {
			close();
		}
	}

	// Delegate clicks on the fullscreen trigger buttons. They live inside
	// {@html}-rendered markdown, so a document-level listener is simplest and
	// survives the markdown container being rebuilt on every edit.
	function onDocClick(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof Element)) {
			return;
		}
		const btn = target.closest(`.${MERMAID_FULLSCREEN_BTN_CLASS}`);
		if (!btn) {
			return;
		}
		const svg = btn.closest('.mermaid-diagram')?.querySelector('svg');
		if (svg instanceof SVGElement) {
			openWith(svg);
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) {
			return;
		}
		if (e.key === 'Escape') {
			close();
		} else if (e.key === '+' || e.key === '=') {
			zoom(STEP);
		} else if (e.key === '-') {
			zoom(-STEP);
		} else if (e.key === '0') {
			resetZoom();
		}
	}

	// Ctrl/Cmd + wheel zooms when the overlay is open (matches map/figure UX).
	function onWheel(e: WheelEvent) {
		if (!open || !(e.ctrlKey || e.metaKey)) {
			return;
		}
		e.preventDefault();
		zoom(e.deltaY < 0 ? STEP : -STEP);
	}

	function onResize() {
		if (open) {
			fitToStage();
		}
	}

	// Fit once the SVG has been inserted into the stage.
	$effect(() => {
		if (open && svgHtml) {
			tick().then(fitToStage);
		}
	});

	onMount(() => {
		document.addEventListener('click', onDocClick);
		window.addEventListener('keydown', onKeydown);
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('click', onDocClick);
			window.removeEventListener('keydown', onKeydown);
			window.removeEventListener('resize', onResize);
		};
	});
</script>

{#if open}
	<!-- Backdrop click-to-close is a convenience; keyboard users close via the
	     Escape handler bound on window (onKeydown), so no element-level key
	     handler is needed here. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Diagram fullscreen view"
		tabindex="-1"
		onclick={onBackdropClick}
		onwheel={onWheel}
	>
		<div class="toolbar">
			<button type="button" onclick={() => zoom(-STEP)} aria-label="Zoom out" title="Zoom out">
				<Icon name="chevron-down" size={16} />
			</button>
			<span class="zoom-label">{Math.round(scale * 100)}%</span>
			<button type="button" onclick={() => zoom(STEP)} aria-label="Zoom in" title="Zoom in">
				<Icon name="plus" size={16} />
			</button>
			<button type="button" onclick={resetZoom} aria-label="Fit to screen" title="Fit to screen">
				<Icon name="refresh" size={15} />
			</button>
			<div class="divider"></div>
			<button type="button" onclick={close} aria-label="Close fullscreen" title="Close (Esc)">
				<Icon name="x" size={16} />
			</button>
		</div>

		<div class="stage" bind:this={stageEl}>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- SVG is mermaid-rendered (securityLevel strict) and already trusted in the document -->
			<div class="diagram" bind:this={diagramEl}>{@html svgHtml}</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		background: color-mix(in srgb, var(--geist-background) 88%, black);
		backdrop-filter: blur(4px);
	}
	.toolbar {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 5px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-medium);
		z-index: 1;
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		color: var(--accents-6);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}
	.toolbar button:hover {
		color: var(--geist-foreground);
		background: var(--accents-1);
	}
	.zoom-label {
		min-width: 44px;
		text-align: center;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-6);
	}
	.divider {
		width: 1px;
		height: 20px;
		margin: 0 2px;
		background: var(--border);
	}
	.stage {
		flex: 1;
		min-height: 0;
		/* Flex + auto margins on the child centers when it fits and stays fully
		   scrollable when it overflows — unlike justify/align center, which
		   clips the top/left of an oversized child. */
		display: flex;
		overflow: auto;
	}
	.diagram {
		margin: auto;
		padding: 48px;
	}
	.diagram :global(svg) {
		display: block;
	}
</style>
