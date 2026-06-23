<script lang="ts">
	// A little flame for the "burning" priority rating. Filled & fiery when lit,
	// a faint grey outline when not.
	let { on = false, size = 11 }: { on?: boolean; size?: number } = $props();
</script>

<svg class="flame" class:on width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	<path
		d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
	/>
</svg>

<style>
	.flame {
		display: block;
		fill: var(--accents-3);
		transition: fill 120ms ease;
	}
	.flame.on {
		fill: var(--fire, #ff5a1f);
	}
</style>
