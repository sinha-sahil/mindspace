<script lang="ts">
	import { Modal, Button } from 'polymorph-ui-components';
	import Icon from '$lib/client/components/Icon.svelte';
	import { whatsNew } from '../store.svelte';
</script>

{#if whatsNew.open}
	<Modal
		classes="ms-modal"
		size="fit-content"
		header={{ text: "What's new" }}
		onoverlayclick={() => whatsNew.dismiss()}
	>
		{#snippet content()}
			<div class="whats-new">
				<p class="intro">Here's what we shipped since your last visit.</p>
				<div class="releases">
					{#each whatsNew.releases as release (release.id)}
						<section class="release">
							<div class="release-head">
								<span class="release-title">{release.title}</span>
								<span class="release-date">{release.date}</span>
							</div>
							<ul class="features">
								{#each release.features as feature (feature.title)}
									<li class="feature">
										<span class="feature-icon" aria-hidden="true">
											<Icon name={feature.icon ?? 'sparkles'} size={16} />
										</span>
										<span class="feature-text">
											<span class="feature-title">{feature.title}</span>
											<span class="feature-desc">{feature.description}</span>
										</span>
									</li>
								{/each}
							</ul>
						</section>
					{/each}
				</div>
			</div>
		{/snippet}
		{#snippet footerSnippet()}
			<Button text="Got it" onclick={() => whatsNew.dismiss()} />
		{/snippet}
	</Modal>
{/if}

<style>
	.whats-new {
		width: min(560px, 92vw);
		padding: 18px 20px 20px;
	}
	.intro {
		margin: 0 0 18px;
		font-size: 13px;
		color: var(--muted);
	}

	.releases {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.release {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.release + .release {
		padding-top: 20px;
		border-top: 1px solid var(--border);
	}
	.release-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.release-title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--fg);
	}
	.release-date {
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		flex-shrink: 0;
	}

	.features {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.feature {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.feature-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		color: var(--accent, var(--fg));
		background: color-mix(in srgb, var(--accent, var(--sage)) 12%, transparent);
		border-radius: 8px;
	}
	.feature-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.feature-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg);
	}
	.feature-desc {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--fg-2);
	}
</style>
