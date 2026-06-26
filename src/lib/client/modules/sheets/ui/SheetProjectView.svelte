<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Icon from '$lib/client/components/Icon.svelte';
	import type { Project } from '$lib/client/modules/projects';
	import {
		parseBook,
		serializeBook,
		activeSheet,
		getRaw,
		getCell,
		setCellRaw,
		updateCellFormat,
		clearRangeContents,
		setColWidth,
		setRowHeight,
		colWidth,
		rowHeight,
		addRows,
		addCols,
		addSheet as addSheetTab,
		removeSheet as removeSheetTab,
		renameSheet as renameSheetTab,
		selectSheet as selectSheetTab,
		colToLetter,
		toA1,
		HEADER_WIDTH,
		type SheetBook,
		type CellFormat,
		type NumberFormat,
		type Align
	} from '../model';
	import { Engine, translateFormula } from '../engine';

	type Props = {
		project: Project;
		saving: boolean;
		onSceneChange: (scene: string) => void;
		onRename: (name: string) => void;
	};
	let { project, saving, onSceneChange, onRename }: Props = $props();

	// The whole workbook lives in project.scene (JSONB). We hold a reactive copy,
	// mutate it through the pure helpers in model.ts, recompute derived values
	// with the formula engine, and stream the serialized book back through
	// onSceneChange (which debounce-saves). The parent keys this component by
	// project id, so a fresh book is parsed per project.
	let book = $state<SheetBook>(untrack(() => parseBook(project.scene)));
	// Bumped on every data mutation so the engine (and thus every displayed
	// value) recomputes — the engine reads cell contents lazily, which Svelte's
	// template dependency tracking wouldn't otherwise see.
	let rev = $state(0);
	const engine = $derived.by(() => {
		void rev;
		return new Engine(book);
	});
	const sheet = $derived(activeSheet(book));

	function persist() {
		onSceneChange(serializeBook(book));
	}

	// ----- undo / redo -----
	let undoStack = $state<string[]>([]);
	let redoStack = $state<string[]>([]);
	const HISTORY_CAP = 80;

	function snapshot() {
		undoStack = [...undoStack, serializeBook(book)].slice(-HISTORY_CAP);
		redoStack = [];
	}
	/** Snapshot, run a data mutation, recompute, and persist. */
	function mutate(fn: () => void) {
		snapshot();
		fn();
		rev++;
		persist();
	}
	function undo() {
		if (undoStack.length === 0) {
			return;
		}
		const prev = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
		redoStack = [...redoStack, serializeBook(book)].slice(-HISTORY_CAP);
		book = parseBook(prev);
		rev++;
		clampSelection();
		persist();
	}
	function redo() {
		if (redoStack.length === 0) {
			return;
		}
		const next = redoStack[redoStack.length - 1];
		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, serializeBook(book)].slice(-HISTORY_CAP);
		book = parseBook(next);
		rev++;
		clampSelection();
		persist();
	}

	// ----- selection -----
	// (ar, ac) = active cell; (fr, fc) = the anchor a range extends from.
	let sel = $state({ ar: 0, ac: 0, fr: 0, fc: 0 });
	const range = $derived({
		r1: Math.min(sel.ar, sel.fr),
		c1: Math.min(sel.ac, sel.fc),
		r2: Math.max(sel.ar, sel.fr),
		c2: Math.max(sel.ac, sel.fc)
	});

	function clampSelection() {
		const maxR = sheet.rows - 1;
		const maxC = sheet.cols - 1;
		sel.ar = Math.min(maxR, Math.max(0, sel.ar));
		sel.ac = Math.min(maxC, Math.max(0, sel.ac));
		sel.fr = Math.min(maxR, Math.max(0, sel.fr));
		sel.fc = Math.min(maxC, Math.max(0, sel.fc));
	}

	function setActive(r: number, c: number, extend: boolean) {
		const row = Math.min(sheet.rows - 1, Math.max(0, r));
		const col = Math.min(sheet.cols - 1, Math.max(0, c));
		sel.ar = row;
		sel.ac = col;
		if (!extend) {
			sel.fr = row;
			sel.fc = col;
		}
		scrollActiveIntoView();
	}
	function moveActive(dr: number, dc: number, extend: boolean) {
		setActive(sel.ar + dr, sel.ac + dc, extend);
	}

	function inRange(r: number, c: number): boolean {
		return r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
	}

	let gridScrollEl: HTMLDivElement | null = $state(null);
	function scrollActiveIntoView() {
		queueMicrotask(() => {
			const el = gridScrollEl?.querySelector<HTMLElement>(
				`[data-r="${sel.ar}"][data-c="${sel.ac}"]`
			);
			el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	}

	// ----- editing -----
	let editing = $state<{ r: number; c: number } | null>(null);
	let editValue = $state('');
	let editSource = $state<'grid' | 'bar'>('grid');
	let selectAllOnFocus = $state(false);

	function startEdit(r: number, c: number, initial: string | null = null) {
		setActive(r, c, false);
		editing = { r, c };
		editSource = 'grid';
		if (initial !== null) {
			editValue = initial;
			selectAllOnFocus = false;
		} else {
			editValue = getRaw(sheet, r, c);
			selectAllOnFocus = true;
		}
	}
	function startEditFromBar() {
		if (editing) {
			return;
		}
		editing = { r: sel.ar, c: sel.ac };
		editSource = 'bar';
		editValue = getRaw(sheet, sel.ar, sel.ac);
	}
	function commitEdit(dr: number, dc: number) {
		const e = editing;
		if (!e) {
			return;
		}
		const value = editValue;
		editing = null;
		mutate(() => setCellRaw(sheet, e.r, e.c, value));
		if (dr !== 0 || dc !== 0) {
			moveActive(dr, dc, false);
		}
		// The editor <input> just unmounted; pull focus back to the grid so the
		// keyboard data-entry loop (type → Enter → type) keeps working.
		gridScrollEl?.focus();
	}
	function cancelEdit() {
		editing = null;
		gridScrollEl?.focus();
	}

	const editorAttach: Attachment<HTMLInputElement> = (el) => {
		if (editSource !== 'grid') {
			return;
		}
		el.focus();
		if (selectAllOnFocus) {
			el.select();
		} else {
			const len = el.value.length;
			el.setSelectionRange(len, len);
		}
	};

	function onEditorKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitEdit(e.shiftKey ? -1 : 1, 0);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			commitEdit(0, e.shiftKey ? -1 : 1);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
		e.stopPropagation();
	}

	// ----- grid keyboard (selection / navigation) -----
	function onGridKeydown(e: KeyboardEvent) {
		if (editing) {
			return;
		}
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key;
		if (mod && (k === 'z' || k === 'Z')) {
			e.preventDefault();
			if (e.shiftKey) {
				redo();
			} else {
				undo();
			}
			return;
		}
		if (mod && (k === 'y' || k === 'Y')) {
			e.preventDefault();
			redo();
			return;
		}
		if (mod && (k === 'b' || k === 'B')) {
			e.preventDefault();
			toggleFmt('bold');
			return;
		}
		if (mod && (k === 'i' || k === 'I')) {
			e.preventDefault();
			toggleFmt('italic');
			return;
		}
		if (mod && (k === 'u' || k === 'U')) {
			e.preventDefault();
			toggleFmt('underline');
			return;
		}
		if (mod && (k === 'a' || k === 'A')) {
			e.preventDefault();
			sel.fr = 0;
			sel.fc = 0;
			sel.ar = sheet.rows - 1;
			sel.ac = sheet.cols - 1;
			return;
		}
		if (mod && k === 'Home') {
			e.preventDefault();
			setActive(0, 0, e.shiftKey);
			return;
		}
		switch (k) {
			case 'ArrowUp':
				e.preventDefault();
				moveActive(-1, 0, e.shiftKey);
				break;
			case 'ArrowDown':
				e.preventDefault();
				moveActive(1, 0, e.shiftKey);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				moveActive(0, -1, e.shiftKey);
				break;
			case 'ArrowRight':
				e.preventDefault();
				moveActive(0, 1, e.shiftKey);
				break;
			case 'Tab':
				e.preventDefault();
				moveActive(0, e.shiftKey ? -1 : 1, false);
				break;
			case 'Enter':
				e.preventDefault();
				moveActive(e.shiftKey ? -1 : 1, 0, false);
				break;
			case 'F2':
				e.preventDefault();
				startEdit(sel.ar, sel.ac);
				break;
			case 'Delete':
			case 'Backspace':
				e.preventDefault();
				mutate(() => clearRangeContents(sheet, range.r1, range.c1, range.r2, range.c2));
				break;
			case 'Escape':
				e.preventDefault();
				sel.fr = sel.ar;
				sel.fc = sel.ac;
				break;
			case 'Home':
				e.preventDefault();
				setActive(sel.ar, 0, e.shiftKey);
				break;
			default:
				// A printable key starts editing with that character.
				if (k.length === 1 && !mod && !e.altKey) {
					e.preventDefault();
					startEdit(sel.ar, sel.ac, k);
				}
		}
	}

	// ----- pointer selection -----
	let selecting = false;
	function onCellPointerDown(e: PointerEvent, r: number, c: number) {
		if (e.button !== 0) {
			return;
		}
		if (editing) {
			commitEdit(0, 0);
		}
		setActive(r, c, e.shiftKey);
		selecting = true;
		gridScrollEl?.focus();
	}
	function onCellPointerEnter(r: number, c: number) {
		if (selecting) {
			setActive(r, c, true);
		}
	}
	function endSelecting() {
		selecting = false;
	}

	function selectColumn(c: number, extend: boolean) {
		sel.ac = c;
		sel.ar = 0;
		sel.fc = extend ? sel.fc : c;
		sel.fr = sheet.rows - 1;
		gridScrollEl?.focus();
	}
	function selectRow(r: number, extend: boolean) {
		sel.ar = r;
		sel.ac = 0;
		sel.fr = extend ? sel.fr : r;
		sel.fc = sheet.cols - 1;
		gridScrollEl?.focus();
	}
	function selectAll() {
		sel.fr = 0;
		sel.fc = 0;
		sel.ar = sheet.rows - 1;
		sel.ac = sheet.cols - 1;
		gridScrollEl?.focus();
	}

	// ----- clipboard -----
	type ClipCell = { v: string; f?: CellFormat };
	let clipboard: { r1: number; c1: number; r2: number; c2: number; cells: ClipCell[][] } | null =
		null;
	let lastCopyText = '';

	function rangeTsv(): string {
		const lines: string[] = [];
		for (let r = range.r1; r <= range.r2; r++) {
			const cols: string[] = [];
			for (let c = range.c1; c <= range.c2; c++) {
				cols.push(engine.display(sheet.id, r, c).replace(/\t/g, ' ').replace(/\n/g, ' '));
			}
			lines.push(cols.join('\t'));
		}
		return lines.join('\n');
	}
	function captureClipboard() {
		const cells: ClipCell[][] = [];
		for (let r = range.r1; r <= range.r2; r++) {
			const line: ClipCell[] = [];
			for (let c = range.c1; c <= range.c2; c++) {
				const cell = getCell(sheet, r, c);
				line.push({ v: cell?.v ?? '', f: cell?.f });
			}
			cells.push(line);
		}
		clipboard = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2, cells };
	}

	function onCopy(e: ClipboardEvent) {
		if (editing || !e.clipboardData) {
			return;
		}
		e.preventDefault();
		captureClipboard();
		const tsv = rangeTsv();
		lastCopyText = tsv;
		e.clipboardData.setData('text/plain', tsv);
	}
	function onCut(e: ClipboardEvent) {
		if (editing || !e.clipboardData) {
			return;
		}
		e.preventDefault();
		captureClipboard();
		const tsv = rangeTsv();
		lastCopyText = tsv;
		e.clipboardData.setData('text/plain', tsv);
		mutate(() => clearRangeContents(sheet, range.r1, range.c1, range.r2, range.c2));
	}
	function onPaste(e: ClipboardEvent) {
		if (editing || !e.clipboardData) {
			return;
		}
		e.preventDefault();
		const text = e.clipboardData.getData('text/plain');
		const baseR = sel.ar;
		const baseC = sel.ac;
		// Internal paste (our own copy): translate relative formulas + keep format.
		if (clipboard && text === lastCopyText) {
			const clip = clipboard;
			// The whole block shifts by a constant offset from its copy origin.
			const dRow = baseR - clip.r1;
			const dCol = baseC - clip.c1;
			mutate(() => {
				for (let i = 0; i < clip.cells.length; i++) {
					for (let j = 0; j < clip.cells[i].length; j++) {
						const src = clip.cells[i][j];
						const destR = baseR + i;
						const destC = baseC + j;
						const value = src.v.startsWith('=') ? translateFormula(src.v, dRow, dCol) : src.v;
						setCellRaw(sheet, destR, destC, value);
						if (src.f) {
							updateCellFormat(sheet, destR, destC, src.f);
						}
					}
				}
			});
			setActive(baseR, baseC, false);
			sel.fr = baseR + clip.cells.length - 1;
			sel.fc = baseC + (clip.cells[0]?.length ?? 1) - 1;
			return;
		}
		// External paste: split TSV into literal values.
		const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
		if (rows.length && rows[rows.length - 1] === '') {
			rows.pop();
		}
		mutate(() => {
			for (let i = 0; i < rows.length; i++) {
				const cols = rows[i].split('\t');
				for (let j = 0; j < cols.length; j++) {
					setCellRaw(sheet, baseR + i, baseC + j, cols[j]);
				}
			}
		});
		setActive(baseR, baseC, false);
		sel.fr = baseR + Math.max(0, rows.length - 1);
		sel.fc = baseC + Math.max(0, (rows[0]?.split('\t').length ?? 1) - 1);
	}

	// ----- formatting -----
	function forEachInRange(fn: (r: number, c: number) => void) {
		for (let r = range.r1; r <= range.r2; r++) {
			for (let c = range.c1; c <= range.c2; c++) {
				fn(r, c);
			}
		}
	}
	function setFmt(patch: Partial<CellFormat>) {
		mutate(() => forEachInRange((r, c) => updateCellFormat(sheet, r, c, patch)));
	}
	function toggleFmt(key: 'bold' | 'italic' | 'underline' | 'strike' | 'wrap') {
		const cur = getCell(sheet, sel.ar, sel.ac)?.f?.[key] ?? false;
		setFmt({ [key]: !cur });
	}
	function setAlign(align: Align) {
		setFmt({ align });
	}
	function setNumFmt(numFmt: NumberFormat) {
		setFmt({ numFmt });
		numFmtMenuOpen = false;
	}
	function clearFormatting() {
		setFmt({
			bold: false,
			italic: false,
			underline: false,
			strike: false,
			wrap: false,
			align: 'left',
			color: '',
			bg: '',
			numFmt: 'auto'
		});
	}

	const activeFmt = $derived(getCell(sheet, sel.ar, sel.ac)?.f ?? {});

	// ----- toolbar menus -----
	let numFmtMenuOpen = $state(false);
	let textColorOpen = $state(false);
	let fillColorOpen = $state(false);

	const NUMBER_FORMATS: { v: NumberFormat; label: string; hint: string }[] = [
		{ v: 'auto', label: 'Automatic', hint: '' },
		{ v: 'number', label: 'Number', hint: '1,234.50' },
		{ v: 'integer', label: 'Integer', hint: '1,235' },
		{ v: 'currency', label: 'Currency', hint: '$1,234.50' },
		{ v: 'percent', label: 'Percent', hint: '12.50%' },
		{ v: 'scientific', label: 'Scientific', hint: '1.23E+3' },
		{ v: 'date', label: 'Date', hint: 'Jun 26, 2026' },
		{ v: 'datetime', label: 'Date time', hint: 'Jun 26, 2026 13:00' },
		{ v: 'time', label: 'Time', hint: '13:00:00' },
		{ v: 'text', label: 'Plain text', hint: '' }
	];

	const SWATCHES = [
		'#1f2937',
		'#ef4444',
		'#f97316',
		'#eab308',
		'#22c55e',
		'#0ea5e9',
		'#6366f1',
		'#a855f7',
		'#ec4899',
		'#78716c',
		'#ffffff',
		'#000000'
	];

	function closeMenusOnOutside(e: MouseEvent) {
		const t = e.target;
		if (!(t instanceof Element)) {
			return;
		}
		if (!t.closest('.numfmt-wrap')) {
			numFmtMenuOpen = false;
		}
		if (!t.closest('.text-color-wrap')) {
			textColorOpen = false;
		}
		if (!t.closest('.fill-color-wrap')) {
			fillColorOpen = false;
		}
	}

	// ----- column / row resize -----
	let resizing = $state(false);
	function startColResize(e: PointerEvent, col: number) {
		if (e.button !== 0) {
			return;
		}
		e.stopPropagation();
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startW = colWidth(sheet, col);
		const handle = e.currentTarget;
		if (!(handle instanceof HTMLElement)) {
			resizing = false;
			return;
		}
		handle.setPointerCapture(e.pointerId);
		// One undoable step per resize: snapshot the pre-resize state (this also
		// invalidates the redo stack so the document and history stay in sync).
		snapshot();
		const move = (ev: PointerEvent) => {
			setColWidth(sheet, col, startW + (ev.clientX - startX));
			rev++;
		};
		const up = () => {
			resizing = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			persist();
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
	}
	function startRowResize(e: PointerEvent, row: number) {
		if (e.button !== 0) {
			return;
		}
		e.stopPropagation();
		e.preventDefault();
		resizing = true;
		const startY = e.clientY;
		const startH = rowHeight(sheet, row);
		const handle = e.currentTarget;
		if (!(handle instanceof HTMLElement)) {
			resizing = false;
			return;
		}
		handle.setPointerCapture(e.pointerId);
		snapshot();
		const move = (ev: PointerEvent) => {
			setRowHeight(sheet, row, startH + (ev.clientY - startY));
			rev++;
		};
		const up = () => {
			resizing = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			persist();
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
	}

	// ----- grid geometry -----
	const totalWidth = $derived.by(() => {
		void rev;
		let w = HEADER_WIDTH;
		for (let c = 0; c < sheet.cols; c++) {
			w += colWidth(sheet, c);
		}
		return w;
	});

	// ----- sheet tabs -----
	let tabEditingId = $state<string | null>(null);
	let tabDraft = $state('');
	function startTabRename(id: string, name: string) {
		tabEditingId = id;
		tabDraft = name;
	}
	function commitTabRename() {
		if (tabEditingId) {
			const name = tabDraft.trim();
			const id = tabEditingId;
			tabEditingId = null;
			if (name) {
				mutate(() => renameSheetTab(book, id, name));
			}
		}
	}
	function selectTab(id: string) {
		selectSheetTab(book, id);
		rev++;
		// Switching tabs persists a new activeSheetId. It isn't itself undoable,
		// but it IS a document change, so invalidate any pending redo to keep the
		// persisted book and the undo/redo timeline from diverging.
		redoStack = [];
		persist();
		sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
		editing = null;
	}
	function newTab() {
		mutate(() => addSheetTab(book));
		sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
		editing = null;
	}
	function deleteTab(id: string) {
		if (book.sheets.length <= 1) {
			return;
		}
		const s = book.sheets.find((x) => x.id === id);
		if (!confirm(`Delete sheet "${s?.name ?? ''}"? This can't be undone.`)) {
			return;
		}
		mutate(() => removeSheetTab(book, id));
		sel = { ar: 0, ac: 0, fr: 0, fc: 0 };
	}

	// ----- project title rename (mirrors TodoProjectView) -----
	let titleEditing = $state(false);
	let titleDraft = $state('');
	let titleInputEl: HTMLInputElement | null = $state(null);
	function startTitleEdit() {
		titleDraft = project.name;
		titleEditing = true;
		queueMicrotask(() => titleInputEl?.select());
	}
	function commitTitleEdit() {
		if (!titleEditing) {
			return;
		}
		titleEditing = false;
		const next = titleDraft.trim();
		if (next && next !== project.name) {
			onRename(next);
		}
	}
	function onTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitTitleEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			titleEditing = false;
		}
	}

	// Focus + select an input as soon as it mounts (used for tab rename).
	function focusInput(node: HTMLInputElement) {
		queueMicrotask(() => node.select());
	}

	// Formula-bar value: reflects the in-progress edit, else the active cell raw.
	const formulaBarValue = $derived(editing ? editValue : getRaw(sheet, sel.ar, sel.ac));
	function onFormulaBarInput(e: Event) {
		const input = e.currentTarget;
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		if (!editing) {
			startEditFromBar();
		}
		editValue = input.value;
	}
	function onFormulaBarKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitEdit(1, 0);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	function cellStyle(r: number, c: number): string {
		const f = getCell(sheet, r, c)?.f;
		let s = `width:${colWidth(sheet, c)}px;`;
		if (!f) {
			return s;
		}
		if (f.bold) {
			s += 'font-weight:600;';
		}
		if (f.italic) {
			s += 'font-style:italic;';
		}
		if (f.underline || f.strike) {
			s += `text-decoration:${[f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ')};`;
		}
		if (f.align) {
			s += `text-align:${f.align};justify-content:${f.align === 'center' ? 'center' : f.align === 'right' ? 'flex-end' : 'flex-start'};`;
		}
		if (f.color) {
			s += `color:${f.color};`;
		}
		if (f.bg) {
			s += `background:${f.bg};`;
		}
		if (f.wrap) {
			s += 'white-space:normal;';
		}
		return s;
	}

	const activeLabel = $derived(
		range.r1 === range.r2 && range.c1 === range.c2
			? toA1(sel.ar, sel.ac)
			: `${toA1(range.r1, range.c1)}:${toA1(range.r2, range.c2)}`
	);
</script>

<svelte:window onmousedown={closeMenusOnOutside} onpointerup={endSelecting} />

<section class="sheet">
	<header class="head">
		{#if titleEditing}
			<input
				bind:this={titleInputEl}
				class="title-input"
				bind:value={titleDraft}
				onblur={commitTitleEdit}
				onkeydown={onTitleKeydown}
				maxlength="200"
				aria-label="Project name"
			/>
		{:else}
			<button
				type="button"
				class="title-btn"
				ondblclick={startTitleEdit}
				title="Double-click to rename"
			>
				{project.name}
			</button>
		{/if}
		<div class="head-right">
			<span class="save-pill" class:saving>
				<span class="dot"></span>{saving ? 'Saving' : 'Saved'}
			</span>
		</div>
	</header>

	<!-- toolbar -->
	<div class="toolbar">
		<button
			type="button"
			class="tb-btn"
			title="Undo (⌘Z)"
			disabled={undoStack.length === 0}
			onclick={undo}
		>
			<Icon name="undo" size={14} />
		</button>
		<button
			type="button"
			class="tb-btn"
			title="Redo (⌘⇧Z)"
			disabled={redoStack.length === 0}
			onclick={redo}
		>
			<span class="flip"><Icon name="undo" size={14} /></span>
		</button>
		<span class="tb-sep"></span>

		<button
			type="button"
			class="tb-btn glyph bold"
			class:on={activeFmt.bold}
			title="Bold (⌘B)"
			onclick={() => toggleFmt('bold')}>B</button
		>
		<button
			type="button"
			class="tb-btn glyph italic"
			class:on={activeFmt.italic}
			title="Italic (⌘I)"
			onclick={() => toggleFmt('italic')}>I</button
		>
		<button
			type="button"
			class="tb-btn glyph underline"
			class:on={activeFmt.underline}
			title="Underline (⌘U)"
			onclick={() => toggleFmt('underline')}>U</button
		>
		<button
			type="button"
			class="tb-btn glyph strike"
			class:on={activeFmt.strike}
			title="Strikethrough"
			onclick={() => toggleFmt('strike')}>S</button
		>

		<span class="tb-sep"></span>

		<div class="text-color-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn color-btn"
				title="Text color"
				onclick={() => (textColorOpen = !textColorOpen)}
			>
				A<span class="color-underbar" style="background:{activeFmt.color ?? 'var(--fg)'}"></span>
			</button>
			{#if textColorOpen}
				<div class="color-menu" role="menu">
					<div class="swatches">
						{#each SWATCHES as sw (sw)}
							<button
								type="button"
								class="swatch"
								style="background:{sw}"
								aria-label={sw}
								onclick={() => {
									setFmt({ color: sw });
									textColorOpen = false;
								}}
							></button>
						{/each}
					</div>
					<button
						type="button"
						class="color-reset"
						onclick={() => {
							setFmt({ color: '' });
							textColorOpen = false;
						}}>Reset</button
					>
				</div>
			{/if}
		</div>

		<div class="fill-color-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn color-btn"
				title="Fill color"
				onclick={() => (fillColorOpen = !fillColorOpen)}
			>
				<span class="fill-glyph" style="background:{activeFmt.bg ?? 'transparent'}"></span>
			</button>
			{#if fillColorOpen}
				<div class="color-menu" role="menu">
					<div class="swatches">
						{#each SWATCHES as sw (sw)}
							<button
								type="button"
								class="swatch"
								style="background:{sw}"
								aria-label={sw}
								onclick={() => {
									setFmt({ bg: sw });
									fillColorOpen = false;
								}}
							></button>
						{/each}
					</div>
					<button
						type="button"
						class="color-reset"
						onclick={() => {
							setFmt({ bg: '' });
							fillColorOpen = false;
						}}>No fill</button
					>
				</div>
			{/if}
		</div>

		<span class="tb-sep"></span>

		<button
			type="button"
			class="tb-btn"
			class:on={activeFmt.align === 'left' || !activeFmt.align}
			title="Align left"
			onclick={() => setAlign('left')}
			aria-label="Align left"
		>
			<span class="align-glyph al-left"></span>
		</button>
		<button
			type="button"
			class="tb-btn"
			class:on={activeFmt.align === 'center'}
			title="Align center"
			onclick={() => setAlign('center')}
			aria-label="Align center"
		>
			<span class="align-glyph al-center"></span>
		</button>
		<button
			type="button"
			class="tb-btn"
			class:on={activeFmt.align === 'right'}
			title="Align right"
			onclick={() => setAlign('right')}
			aria-label="Align right"
		>
			<span class="align-glyph al-right"></span>
		</button>
		<button
			type="button"
			class="tb-btn"
			class:on={activeFmt.wrap}
			title="Wrap text"
			onclick={() => toggleFmt('wrap')}
			aria-label="Wrap text"
		>
			<span class="align-glyph al-wrap"></span>
		</button>

		<span class="tb-sep"></span>

		<button type="button" class="tb-btn wide" title="Currency" onclick={() => setNumFmt('currency')}
			>$</button
		>
		<button type="button" class="tb-btn wide" title="Percent" onclick={() => setNumFmt('percent')}
			>%</button
		>
		<div class="numfmt-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn numfmt-trigger"
				title="Number format"
				onclick={() => (numFmtMenuOpen = !numFmtMenuOpen)}
			>
				123 <Icon name="chevron-down" size={11} />
			</button>
			{#if numFmtMenuOpen}
				<div class="numfmt-menu" role="menu">
					{#each NUMBER_FORMATS as nf (nf.v)}
						<button
							type="button"
							class="numfmt-item"
							class:active={(activeFmt.numFmt ?? 'auto') === nf.v}
							onclick={() => setNumFmt(nf.v)}
						>
							<span class="numfmt-label">{nf.label}</span>
							{#if nf.hint}<span class="numfmt-hint">{nf.hint}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<span class="tb-sep"></span>
		<button type="button" class="tb-btn text" title="Clear formatting" onclick={clearFormatting}
			>Clear</button
		>
	</div>

	<!-- formula bar -->
	<div class="formula-bar">
		<span class="name-box">{activeLabel}</span>
		<span class="fx">fx</span>
		<input
			class="formula-input"
			type="text"
			value={formulaBarValue}
			oninput={onFormulaBarInput}
			onkeydown={onFormulaBarKeydown}
			spellcheck="false"
			aria-label="Formula bar"
		/>
	</div>

	<!-- grid -->
	<div
		class="grid-scroll"
		class:resizing
		bind:this={gridScrollEl}
		tabindex="0"
		role="grid"
		aria-label="Spreadsheet grid"
		onkeydown={onGridKeydown}
		oncopy={onCopy}
		oncut={onCut}
		onpaste={onPaste}
	>
		<div class="grid" style="width:{totalWidth}px">
			<div class="col-headers">
				<button
					type="button"
					class="corner"
					style="width:{HEADER_WIDTH}px"
					title="Select all"
					aria-label="Select all"
					onclick={selectAll}
				></button>
				{#each Array(sheet.cols) as _, c (c)}
					<div
						class="col-head"
						class:hl={c >= range.c1 && c <= range.c2}
						style="width:{colWidth(sheet, c)}px"
					>
						<button
							type="button"
							class="col-head-label"
							onpointerdown={(e) => selectColumn(c, e.shiftKey)}
						>
							{colToLetter(c)}
						</button>
						<span
							class="col-resize"
							role="separator"
							aria-orientation="vertical"
							aria-label={`Resize column ${colToLetter(c)}`}
							onpointerdown={(e) => startColResize(e, c)}
						></span>
					</div>
				{/each}
			</div>

			{#each Array(sheet.rows) as _, r (r)}
				<div class="grid-row" style="height:{rowHeight(sheet, r)}px">
					<div
						class="row-head"
						class:hl={r >= range.r1 && r <= range.r2}
						style="width:{HEADER_WIDTH}px"
					>
						<button
							type="button"
							class="row-head-label"
							onpointerdown={(e) => selectRow(r, e.shiftKey)}
						>
							{r + 1}
						</button>
						<span
							class="row-resize"
							role="separator"
							aria-orientation="horizontal"
							aria-label={`Resize row ${r + 1}`}
							onpointerdown={(e) => startRowResize(e, r)}
						></span>
					</div>
					{#each Array(sheet.cols) as _, c (c)}
						{@const isActive = sel.ar === r && sel.ac === c}
						{@const isEditing = editing?.r === r && editing?.c === c}
						<div
							class="cell"
							class:active={isActive}
							class:selected={inRange(r, c)}
							role="gridcell"
							tabindex="-1"
							aria-selected={inRange(r, c)}
							data-r={r}
							data-c={c}
							style={cellStyle(r, c)}
							onpointerdown={(e) => onCellPointerDown(e, r, c)}
							onpointerenter={() => onCellPointerEnter(r, c)}
							ondblclick={() => startEdit(r, c)}
						>
							{#if isEditing}
								<input
									class="cell-input"
									type="text"
									bind:value={editValue}
									onkeydown={onEditorKeydown}
									onpointerdown={(e) => e.stopPropagation()}
									spellcheck="false"
									{@attach editorAttach}
								/>
							{:else}
								<span class="cell-text">{engine.display(sheet.id, r, c)}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- bottom: sheet tabs + grow controls -->
	<footer class="tabbar">
		<button type="button" class="tab-add" title="Add sheet" aria-label="Add sheet" onclick={newTab}>
			<Icon name="plus" size={14} />
		</button>
		<div class="tabs">
			{#each book.sheets as s (s.id)}
				<div class="tab" class:active={s.id === book.activeSheetId}>
					{#if tabEditingId === s.id}
						<input
							class="tab-input"
							bind:value={tabDraft}
							onblur={commitTabRename}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									commitTabRename();
								} else if (e.key === 'Escape') {
									tabEditingId = null;
								}
							}}
							use:focusInput
						/>
					{:else}
						<button
							type="button"
							class="tab-label"
							onclick={() => selectTab(s.id)}
							ondblclick={() => startTabRename(s.id, s.name)}
						>
							{s.name}
						</button>
						{#if book.sheets.length > 1 && s.id === book.activeSheetId}
							<button
								type="button"
								class="tab-del"
								title="Delete sheet"
								aria-label="Delete sheet"
								onclick={() => deleteTab(s.id)}
							>
								<Icon name="x" size={11} />
							</button>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
		<div class="grow-controls">
			<button
				type="button"
				class="grow-btn"
				title="Add 20 rows"
				onclick={() => mutate(() => addRows(sheet))}
			>
				<Icon name="plus" size={11} /> Rows
			</button>
			<button
				type="button"
				class="grow-btn"
				title="Add 5 columns"
				onclick={() => mutate(() => addCols(sheet))}
			>
				<Icon name="plus" size={11} /> Cols
			</button>
		</div>
	</footer>
</section>

<style>
	.sheet {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--surface);
	}

	/* ---- header ---- */
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--border);
		min-height: 44px;
		flex-shrink: 0;
	}
	.title-btn {
		margin: 0;
		padding: 2px 6px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 5px;
		cursor: text;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.title-btn:hover {
		background: var(--accents-1);
	}
	.title-input {
		padding: 2px 6px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--accent, var(--border-strong));
		border-radius: 5px;
		outline: none;
		min-width: 200px;
		max-width: 480px;
	}
	.head-right {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}
	.save-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--accents-5);
	}
	.save-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--geist-success);
	}
	.save-pill.saving .dot {
		background: var(--geist-warning);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}

	/* ---- toolbar ---- */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 5px 12px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
		flex-wrap: wrap;
	}
	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-width: 28px;
		height: 28px;
		padding: 0 6px;
		font: inherit;
		font-size: 13px;
		color: var(--accents-7);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		transition:
			background 100ms,
			border-color 100ms;
	}
	.tb-btn:hover {
		background: var(--accents-1);
	}
	.tb-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.tb-btn.on {
		background: var(--accent-soft, var(--accents-2));
		border-color: color-mix(in srgb, var(--accent, var(--geist-foreground)) 35%, transparent);
		color: var(--accent, var(--geist-foreground));
	}
	.tb-btn.glyph {
		font-weight: 700;
		font-size: 14px;
	}
	.tb-btn.glyph.italic {
		font-style: italic;
		font-family: var(--font-display, serif);
	}
	.tb-btn.glyph.underline {
		text-decoration: underline;
	}
	.tb-btn.glyph.strike {
		text-decoration: line-through;
	}
	.tb-btn.text {
		font-size: 12px;
		color: var(--accents-6);
	}
	.tb-btn.wide {
		font-weight: 600;
	}
	.tb-sep {
		width: 1px;
		height: 18px;
		margin: 0 4px;
		background: var(--border);
	}
	.flip {
		display: inline-flex;
		transform: scaleX(-1);
	}
	.numfmt-trigger {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.menu-wrap {
		position: relative;
		display: inline-flex;
	}
	.color-btn {
		flex-direction: column;
		gap: 0;
		font-weight: 600;
	}
	.color-underbar {
		width: 16px;
		height: 3px;
		border-radius: 2px;
		margin-top: -2px;
	}
	.fill-glyph {
		width: 16px;
		height: 16px;
		border-radius: 4px;
		border: 1px solid var(--border);
	}
	.color-menu,
	.numfmt-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 60;
		padding: 8px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-medium);
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 4px;
	}
	.swatch {
		width: 20px;
		height: 20px;
		border-radius: 5px;
		border: 1px solid var(--border);
		cursor: pointer;
		padding: 0;
	}
	.swatch:hover {
		transform: scale(1.1);
	}
	.color-reset {
		margin-top: 8px;
		width: 100%;
		padding: 5px;
		font: inherit;
		font-size: 12px;
		color: var(--accents-6);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.numfmt-menu {
		min-width: 200px;
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.numfmt-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
	}
	.numfmt-item:hover {
		background: var(--accents-1);
	}
	.numfmt-item.active {
		background: var(--accent-soft, var(--accents-2));
	}
	.numfmt-hint {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-5);
	}
	.align-glyph {
		position: relative;
		display: inline-block;
		width: 15px;
		height: 11px;
	}
	.align-glyph::before,
	.align-glyph::after {
		content: '';
		position: absolute;
		height: 1.6px;
		background: currentColor;
		border-radius: 1px;
	}
	.align-glyph::before {
		top: 2px;
		width: 15px;
	}
	.align-glyph::after {
		bottom: 2px;
		width: 10px;
	}
	.al-left::after {
		left: 0;
	}
	.al-center::after {
		left: 2.5px;
	}
	.al-right::after {
		right: 0;
	}
	.al-wrap::before {
		width: 15px;
	}
	.al-wrap::after {
		width: 15px;
	}

	/* ---- formula bar ---- */
	.formula-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 12px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.name-box {
		min-width: 72px;
		padding: 4px 8px;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--accents-7);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		text-align: center;
	}
	.fx {
		font-family: var(--font-display, serif);
		font-style: italic;
		font-size: 13px;
		color: var(--accents-5);
	}
	.formula-input {
		flex: 1;
		min-width: 0;
		padding: 4px 8px;
		font: inherit;
		font-size: 13px;
		font-family: var(--font-mono);
		color: var(--geist-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		outline: none;
	}
	.formula-input:focus {
		background: var(--surface);
		border-color: var(--accent, var(--border-strong));
	}

	/* ---- grid ---- */
	.grid-scroll {
		flex: 1;
		min-height: 0;
		overflow: auto;
		outline: none;
		background: var(--bg);
		position: relative;
	}
	.grid-scroll.resizing {
		user-select: none;
		cursor: col-resize;
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
		padding: 0;
		background: var(--accents-2);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		cursor: pointer;
	}
	.col-head {
		position: relative;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		background: var(--accents-1);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.col-head.hl {
		background: var(--accent-soft, var(--accents-2));
	}
	.col-head-label {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--accents-6);
		background: transparent;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.col-head.hl .col-head-label {
		color: var(--accent, var(--geist-foreground));
	}
	.col-resize {
		position: absolute;
		top: 0;
		right: -3px;
		width: 6px;
		height: 100%;
		cursor: col-resize;
		z-index: 5;
	}
	.col-resize:hover {
		background: color-mix(in srgb, var(--accent, var(--geist-foreground)) 50%, transparent);
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
		align-items: stretch;
		background: var(--accents-1);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.row-head.hl {
		background: var(--accent-soft, var(--accents-2));
	}
	.row-head-label {
		flex: 1;
		font: inherit;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-6);
		background: transparent;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.row-head.hl .row-head-label {
		color: var(--accent, var(--geist-foreground));
	}
	.row-resize {
		position: absolute;
		bottom: -3px;
		left: 0;
		width: 100%;
		height: 6px;
		cursor: row-resize;
		z-index: 5;
	}
	.cell {
		position: relative;
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
		cursor: cell;
		box-sizing: border-box;
	}
	.cell-text {
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		width: 100%;
	}
	.cell.selected {
		background: color-mix(in srgb, var(--accent, #3b82f6) 12%, var(--surface));
	}
	.cell.active {
		background: var(--surface);
		box-shadow: inset 0 0 0 2px var(--accent, #3b82f6);
		z-index: 1;
	}
	.cell-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		padding: 0 4px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: var(--surface);
		border: none;
		outline: 2px solid var(--accent, #3b82f6);
		outline-offset: -2px;
		z-index: 6;
		box-sizing: border-box;
	}

	/* ---- bottom tabs ---- */
	.tabbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-top: 1px solid var(--border);
		background: var(--accents-1);
		flex-shrink: 0;
		min-height: 36px;
	}
	.tab-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		flex-shrink: 0;
		color: var(--accents-6);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.tab-add:hover {
		color: var(--geist-foreground);
		background: var(--surface);
	}
	.tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		overflow-x: auto;
		flex: 1;
		min-width: 0;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0 4px 0 10px;
		height: 26px;
		flex-shrink: 0;
		border-radius: 6px;
		border: 1px solid transparent;
	}
	.tab.active {
		background: var(--surface);
		border-color: var(--border);
		box-shadow: var(--shadow-sm);
	}
	.tab-label {
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--accents-6);
		background: transparent;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		padding: 4px 2px;
	}
	.tab.active .tab-label {
		color: var(--geist-foreground);
	}
	.tab-input {
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		width: 96px;
		padding: 2px 4px;
		border: 1px solid var(--accent, var(--border-strong));
		border-radius: 4px;
		outline: none;
	}
	.tab-del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		color: var(--accents-5);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	.tab-del:hover {
		color: var(--geist-error);
		background: var(--accents-2);
	}
	.grow-controls {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}
	.grow-btn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 4px 8px;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--accents-6);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.grow-btn:hover {
		color: var(--geist-foreground);
		background: var(--surface);
	}
</style>
