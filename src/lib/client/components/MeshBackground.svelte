<script lang="ts">
	type Props = { variant?: 'default' | 'subtle' };
	let { variant = 'default' }: Props = $props();
</script>

<div class="mesh" class:subtle={variant === 'subtle'} aria-hidden="true">
	<div class="blob blob-1"></div>
	<div class="blob blob-2"></div>
	<div class="blob blob-3"></div>
	<div class="blob blob-4"></div>
	<div class="grain"></div>
	<div class="vignette"></div>
</div>

<style>
	.mesh {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--bg);
	}

	.blob {
		position: absolute;
		border-radius: 50%;
		filter: blur(110px);
		opacity: 0.55;
		will-change: transform;
	}
	.subtle .blob {
		opacity: 0.32;
		filter: blur(140px);
	}

	.blob-1 {
		width: 620px;
		height: 620px;
		background: radial-gradient(circle, var(--mesh-1, #7986f2), transparent 65%);
		top: -180px;
		left: -120px;
		animation: drift1 22s ease-in-out infinite;
	}
	.blob-2 {
		width: 540px;
		height: 540px;
		background: radial-gradient(circle, var(--mesh-2, #c083d3), transparent 65%);
		top: 30%;
		right: -160px;
		animation: drift2 26s ease-in-out infinite;
	}
	.blob-3 {
		width: 480px;
		height: 480px;
		background: radial-gradient(circle, var(--mesh-3, #78c2e6), transparent 65%);
		bottom: -160px;
		left: 25%;
		animation: drift3 30s ease-in-out infinite;
	}
	.blob-4 {
		width: 420px;
		height: 420px;
		background: radial-gradient(circle, var(--mesh-4, #f3c080), transparent 65%);
		bottom: 8%;
		right: 10%;
		animation: drift4 34s ease-in-out infinite;
		opacity: 0.35;
	}

	@keyframes drift1 {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
		}
		50% {
			transform: translate(140px, 80px) scale(1.05);
		}
	}
	@keyframes drift2 {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
		}
		50% {
			transform: translate(-100px, 60px) scale(0.95);
		}
	}
	@keyframes drift3 {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
		}
		50% {
			transform: translate(120px, -90px) scale(1.08);
		}
	}
	@keyframes drift4 {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
		}
		50% {
			transform: translate(-110px, -50px) scale(0.92);
		}
	}

	.grain {
		position: absolute;
		inset: 0;
		opacity: 0.06;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
		mix-blend-mode: overlay;
	}

	.vignette {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at center, transparent 40%, var(--bg) 110%);
	}

	@media (prefers-reduced-motion: reduce) {
		.blob {
			animation: none;
		}
	}
</style>
