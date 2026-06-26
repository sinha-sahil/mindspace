<script lang="ts">
	import {
		parseBook,
		activeSheet,
		getCell,
		colWidth,
		rowHeight,
		selectSheet,
		colToLetter,
		HEADER_WIDTH,
		type Sheet
	} from '../model';
	import { Engine } from '../engine';

	type Props = {
		/** Serialized workbook JSON (same shape stored in project.scene). */
		scene: string;
	};
	let { scene }: Props = $props();

	const book = $derived(parseBook(scene));
	const engine = $derived(new Engine(book));
	const sheet = $derived(activeSheet(book));

	// A local tab selection layered on top of the parsed book, so a viewer can
	// browse sheets without mutating anything persistent.
	let activeId = $state<string | null>(null);
	const shown = $derived(book.sheets.find((s) => s.id === activeId) ?? sheet);

	function selectTab(id: string) {
		activeId = id;
		// keep the book's notion of active in sync for the engine display calls
		selectSheet(book, id);
	}

	const totalWidth = $derived.by(() => {
		let w = HEADER_WIDTH;
		for (let c = 0; c < shown.cols; c++) {
			w += colWidth(shown, c);
		}
		return w;
	});

	function cellStyle(s: Sheet, r: number, c: number): string {
		const f = getCell(s, r, c)?.f;
		let style = `width:${colWidth(s, c)}px;`;
		if (!f) {
			return style;
		}
		if (f.bold) {
			style += 'font-weight:600;';
		}
		if (f.italic) {
			style += 'font-style:italic;';
		}
		if (f.underline || f.strike) {
			style += `text-decoration:${[f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ')};`;
		}
		if (f.align) {
			style += `text-align:${f.align};justify-content:${f.align === 'center' ? 'center' : f.align === 'right' ? 'flex-end' : 'flex-start'};`;
		}
		if (f.color) {
			style += `color:${f.color};`;
		}
		if (f.bg) {
			style += `background:${f.bg};`;
		}
		if (f.wrap) {
			style += 'white-space:normal;';
		}
		return style;
	}
</script>

<div class="sheet-ro">
	<div class="grid-scroll">
		<div class="grid" style="width:{totalWidth}px">
			<div class="col-headers">
				<div class="corner" style="width:{HEADER_WIDTH}px"></div>
				{#each Array(shown.cols) as _, c (c)}
					<div class="col-head" style="width:{colWidth(shown, c)}px">{colToLetter(c)}</div>
				{/each}
			</div>
			{#each Array(shown.rows) as _, r (r)}
				<div class="grid-row" style="height:{rowHeight(shown, r)}px">
					<div class="row-head" style="width:{HEADER_WIDTH}px">{r + 1}</div>
					{#each Array(shown.cols) as _, c (c)}
						<div class="cell" style={cellStyle(shown, r, c)}>
							<span class="cell-text">{engine.display(shown.id, r, c)}</span>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	{#if book.sheets.length > 1}
		<footer class="tabbar">
			{#each book.sheets as s (s.id)}
				<button
					type="button"
					class="tab"
					class:active={s.id === shown.id}
					onclick={() => selectTab(s.id)}
				>
					{s.name}
				</button>
			{/each}
		</footer>
	{/if}
</div>

<style>
	.sheet-ro {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
	}
	.grid-scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.grid {
		position: relative;
		min-width: 100%;
	}
	.col-headers {
		display: flex;
		position: sticky;
		top: 0;
		z-index: 3;
		height: 26px;
	}
	.corner {
		position: sticky;
		left: 0;
		z-index: 4;
		flex-shrink: 0;
		background: var(--accents-2);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.col-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--accents-6);
		background: var(--accents-1);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.grid-row {
		display: flex;
	}
	.row-head {
		position: sticky;
		left: 0;
		z-index: 2;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-6);
		background: var(--accents-1);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.cell {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding: 0 5px;
		font-size: 13px;
		color: var(--geist-foreground);
		background: var(--surface);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		overflow: hidden;
		white-space: nowrap;
		box-sizing: border-box;
	}
	.cell-text {
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		width: 100%;
	}
	.tabbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 5px 10px;
		border-top: 1px solid var(--border);
		background: var(--accents-1);
		overflow-x: auto;
		flex-shrink: 0;
	}
	.tab {
		padding: 5px 12px;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-6);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab.active {
		color: var(--geist-foreground);
		background: var(--surface);
		border-color: var(--border);
	}
</style>
