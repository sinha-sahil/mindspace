<script lang="ts">
	import { documents } from '../store.svelte';

	type Props = {
		documentId: string;
		content: string;
	};
	let { documentId, content }: Props = $props();

	function onInput(e: Event) {
		const target = e.currentTarget;
		if (!(target instanceof HTMLTextAreaElement)) {
			return;
		}
		// Debounced save lives in the store; this fires every keystroke.
		documents.saveContent(documentId, target.value);
	}
</script>

<textarea
	class="md-editor"
	value={content}
	oninput={onInput}
	spellcheck="false"
	placeholder="# Untitled

Start writing in markdown…"
></textarea>

<style>
	.md-editor {
		flex: 1;
		min-height: 0;
		width: 100%;
		padding: 24px 28px;
		font: inherit;
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.55;
		color: var(--geist-foreground);
		background: var(--surface);
		border: none;
		outline: none;
		resize: none;
		white-space: pre-wrap;
		tab-size: 2;
	}
</style>
