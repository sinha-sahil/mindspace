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
		clearRangeAll,
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
		findMerge,
		isCovered,
		isMergeAnchor,
		mergeCells,
		unmergeRange,
		cellKey,
		parseKey,
		colToLetter,
		toA1,
		HEADER_WIDTH,
		DEFAULT_ROW_HEIGHT,
		FONT_FAMILIES,
		FONT_SIZES,
		DEFAULT_FONT_SIZE,
		MAX_INDENT,
		type SheetBook,
		type CellFormat,
		type NumberFormat,
		type Align,
		type VAlign,
		type BorderStyle,
		type Border
	} from '../model';
	import { insertRows, deleteRows, insertCols, deleteCols, fillRange } from '../ops';
	import { Engine, translateFormula } from '../engine';
	import { formatCss, fontStack } from '../style';

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
		let row = Math.min(sheet.rows - 1, Math.max(0, r));
		let col = Math.min(sheet.cols - 1, Math.max(0, c));
		// Landing inside a merge snaps the active cell to its top-left anchor so
		// you never sit on a hidden covered cell.
		if (!extend) {
			const m = findMerge(sheet, row, col);
			if (m) {
				row = m.r1;
				col = m.c1;
			}
		}
		sel.ar = row;
		sel.ac = col;
		if (!extend) {
			sel.fr = row;
			sel.fc = col;
		}
		scrollActiveIntoView();
	}
	function moveActive(dr: number, dc: number, extend: boolean) {
		// Step out from the far edge of the current merge so one keypress crosses
		// the whole block instead of getting stuck inside it.
		const m = findMerge(sheet, sel.ar, sel.ac);
		let r = sel.ar + dr;
		let c = sel.ac + dc;
		if (m) {
			if (dr > 0) {
				r = m.r2 + dr;
			} else if (dr < 0) {
				r = m.r1 + dr;
			}
			if (dc > 0) {
				c = m.c2 + dc;
			} else if (dc < 0) {
				c = m.c1 + dc;
			}
		}
		setActive(r, c, extend);
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
	// The selection captured at edit-start (before it collapses), so Ctrl+Enter
	// can fill the whole originally-selected range.
	let editRange = $state<{ r1: number; c1: number; r2: number; c2: number } | null>(null);

	function startEdit(r: number, c: number, initial: string | null = null) {
		// Capture the multi-cell selection before setActive collapses it.
		editRange = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
		setActive(r, c, false);
		// setActive may have snapped onto a merge anchor — edit the cell we landed
		// on, never a hidden covered cell.
		const er = sel.ar;
		const ec = sel.ac;
		editing = { r: er, c: ec };
		editSource = 'grid';
		if (initial !== null) {
			editValue = initial;
			selectAllOnFocus = false;
		} else {
			editValue = getRaw(sheet, er, ec);
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
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			// Ctrl/Cmd+Enter fills the typed entry across the whole selection.
			e.preventDefault();
			const value = editValue;
			editing = null;
			fillSelectionWith(value);
			gridScrollEl?.focus();
		} else if (e.key === 'Enter') {
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
		if (mod && (k === 'd' || k === 'D')) {
			e.preventDefault();
			fillDown();
			return;
		}
		if (mod && (k === 'r' || k === 'R')) {
			e.preventDefault();
			fillRight();
			return;
		}
		if (mod && (k === 'f' || k === 'F')) {
			e.preventDefault();
			openFind();
			return;
		}
		if (mod && e.shiftKey && (k === 'v' || k === 'V')) {
			e.preventDefault();
			pasteSpecial('values');
			return;
		}
		if (mod && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
			e.preventDefault();
			const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
			const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
			dataEdge(dr, dc, e.shiftKey);
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
				if (painter) {
					painter = null;
				} else if (ctx) {
					ctx = null;
				} else {
					sel.fr = sel.ar;
					sel.fc = sel.ac;
				}
				break;
			case 'Home':
				e.preventDefault();
				setActive(sel.ar, 0, e.shiftKey);
				break;
			case 'End':
				e.preventDefault();
				setActive(sel.ar, sheet.cols - 1, e.shiftKey);
				break;
			case 'PageDown':
				e.preventDefault();
				moveActive(visibleRowCount(), 0, e.shiftKey);
				break;
			case 'PageUp':
				e.preventDefault();
				moveActive(-visibleRowCount(), 0, e.shiftKey);
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
		// Format painter: if armed, paint the captured format onto this cell/range.
		if (painter && !e.shiftKey) {
			applyPainter();
			gridScrollEl?.focus();
			return;
		}
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
	type ClipCell = { v: string; f?: CellFormat; display: string };
	type Clip = { r1: number; c1: number; r2: number; c2: number; cells: ClipCell[][] };
	let clipboard = $state<Clip | null>(null);
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
				line.push({ v: cell?.v ?? '', f: cell?.f, display: engine.display(sheet.id, r, c) });
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
						// Replace destination format with the source's (clear when unformatted).
						setFullFormat(destR, destC, src.f ?? null);
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
		mutate(() => forEachInRange((r, c) => setFullFormat(r, c, null)));
	}

	const activeFmt = $derived(getCell(sheet, sel.ar, sel.ac)?.f ?? {});

	// ----- toolbar menus -----
	let numFmtMenuOpen = $state(false);
	let textColorOpen = $state(false);
	let fillColorOpen = $state(false);
	let fontMenuOpen = $state(false);
	let sizeMenuOpen = $state(false);
	let bordersMenuOpen = $state(false);
	let valignMenuOpen = $state(false);
	let pasteMenuOpen = $state(false);

	const NUMBER_FORMATS: { v: NumberFormat; label: string; hint: string }[] = [
		{ v: 'auto', label: 'Automatic', hint: '' },
		{ v: 'number', label: 'Number', hint: '1,234.50' },
		{ v: 'integer', label: 'Integer', hint: '1,235' },
		{ v: 'currency', label: 'Currency', hint: '$1,234.50' },
		{ v: 'accounting', label: 'Accounting', hint: '($1,234.50)' },
		{ v: 'percent', label: 'Percent', hint: '12.50%' },
		{ v: 'scientific', label: 'Scientific', hint: '1.23E+3' },
		{ v: 'date', label: 'Date', hint: 'Jun 26, 2026' },
		{ v: 'datetime', label: 'Date time', hint: 'Jun 26, 2026 13:00' },
		{ v: 'time', label: 'Time', hint: '13:00:00' },
		{ v: 'duration', label: 'Duration', hint: '12:00:00' },
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

	const BORDER_STYLE_OPTS: BorderStyle[] = [
		'thin',
		'medium',
		'thick',
		'dashed',
		'dotted',
		'double'
	];
	const BORDER_PRESETS: { key: string; label: string; glyph: string }[] = [
		{ key: 'all', label: 'All borders', glyph: '⊞' },
		{ key: 'inner', label: 'Inner', glyph: '田' },
		{ key: 'innerH', label: 'Horizontal inner', glyph: '☰' },
		{ key: 'innerV', label: 'Vertical inner', glyph: '◫' },
		{ key: 'outer', label: 'Outer', glyph: '▢' },
		{ key: 'top', label: 'Top', glyph: '▔' },
		{ key: 'bottom', label: 'Bottom', glyph: '▁' },
		{ key: 'left', label: 'Left', glyph: '▏' },
		{ key: 'right', label: 'Right', glyph: '▕' },
		{ key: 'none', label: 'Clear borders', glyph: '✕' }
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
		if (!t.closest('.font-wrap')) {
			fontMenuOpen = false;
		}
		if (!t.closest('.size-wrap')) {
			sizeMenuOpen = false;
		}
		if (!t.closest('.borders-wrap')) {
			bordersMenuOpen = false;
		}
		if (!t.closest('.valign-wrap')) {
			valignMenuOpen = false;
		}
		if (!t.closest('.paste-wrap')) {
			pasteMenuOpen = false;
		}
		if (ctx && !t.closest('.ctx-menu')) {
			ctx = null;
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
		// Snapshot lazily on the first actual move so a bare click on the resize
		// strip doesn't push a no-op undo entry / wipe the redo stack.
		let changed = false;
		const move = (ev: PointerEvent) => {
			if (!changed) {
				snapshot();
				changed = true;
			}
			setColWidth(sheet, col, startW + (ev.clientX - startX));
			rev++;
		};
		const up = () => {
			resizing = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			if (changed) {
				persist();
			}
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
		let changed = false;
		const move = (ev: PointerEvent) => {
			if (!changed) {
				snapshot();
				changed = true;
			}
			setRowHeight(sheet, row, startH + (ev.clientY - startY));
			rev++;
		};
		const up = () => {
			resizing = false;
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			if (changed) {
				persist();
			}
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
		return (
			`width:${colWidth(sheet, c)}px;` +
			frozenCss(r, c) +
			formatCss(getCell(sheet, r, c)?.f ?? null)
		);
	}
	/** Sticky positioning + opaque backing for cells inside a frozen pane. */
	function frozenCss(r: number, c: number): string {
		const fr = r < sheet.frozenRows;
		const fc = c < sheet.frozenCols;
		if (!fr && !fc) {
			return '';
		}
		let s = 'position:sticky;background:var(--surface);';
		if (fr) {
			s += `top:${topOf(r)}px;`;
		}
		if (fc) {
			s += `left:${leftOf(c)}px;`;
		}
		s += `z-index:${fr && fc ? 6 : fr ? 5 : 4};`;
		return s;
	}

	// =====================================================================
	// grid geometry (cumulative offsets) — for fill handle, merges, freeze
	// =====================================================================
	const GRID_HEADER_H = 26;
	const colLefts = $derived.by(() => {
		void rev;
		const a = [HEADER_WIDTH];
		for (let c = 0; c < sheet.cols; c++) {
			a.push(a[a.length - 1] + colWidth(sheet, c));
		}
		return a;
	});
	const rowTops = $derived.by(() => {
		void rev;
		const a = [GRID_HEADER_H];
		for (let r = 0; r < sheet.rows; r++) {
			a.push(a[a.length - 1] + rowHeight(sheet, r));
		}
		return a;
	});
	function leftOf(c: number): number {
		return colLefts[Math.max(0, Math.min(c, colLefts.length - 1))];
	}
	function topOf(r: number): number {
		return rowTops[Math.max(0, Math.min(r, rowTops.length - 1))];
	}
	function visibleRowCount(): number {
		const h = gridScrollEl?.clientHeight ?? 400;
		return Math.max(1, Math.floor(h / DEFAULT_ROW_HEIGHT) - 1);
	}

	type Rect = { r1: number; c1: number; r2: number; c2: number };

	// Merge blocks positioned absolutely over the grid (handles any shape).
	const mergeBlocks = $derived.by(() => {
		void rev;
		return sheet.merges.map((m) => ({
			m,
			left: leftOf(m.c1),
			top: topOf(m.r1),
			width: leftOf(m.c2 + 1) - leftOf(m.c1),
			height: topOf(m.r2 + 1) - topOf(m.r1)
		}));
	});

	const fillHandle = $derived.by(() => {
		void rev;
		// Expand through a merge at the bottom-right so the handle sits at the
		// block's outer corner, not inside a merged cell.
		const m = findMerge(sheet, range.r2, range.c2);
		const c2 = m ? Math.max(range.c2, m.c2) : range.c2;
		const r2 = m ? Math.max(range.r2, m.r2) : range.r2;
		return { left: leftOf(c2 + 1), top: topOf(r2 + 1) };
	});

	// =====================================================================
	// fill handle (drag to copy/series) + double-click fill-to-edge
	// =====================================================================
	let filling = $state(false);
	let fillDest = $state<Rect | null>(null);

	function cellAtPoint(x: number, y: number): { r: number; c: number } | null {
		const el = document.elementFromPoint(x, y);
		const cell = el instanceof Element ? el.closest('[data-r]') : null;
		if (cell instanceof HTMLElement && cell.dataset.r && cell.dataset.c) {
			const r = Number(cell.dataset.r);
			const c = Number(cell.dataset.c);
			if (Number.isFinite(r) && Number.isFinite(c)) {
				return { r, c };
			}
		}
		return null;
	}
	function computeFillDest(tr: number, tc: number): Rect | null {
		const dv = tr > range.r2 ? tr - range.r2 : tr < range.r1 ? range.r1 - tr : 0;
		const dh = tc > range.c2 ? tc - range.c2 : tc < range.c1 ? range.c1 - tc : 0;
		if (dv === 0 && dh === 0) {
			return null;
		}
		if (dv >= dh) {
			return { r1: Math.min(range.r1, tr), c1: range.c1, r2: Math.max(range.r2, tr), c2: range.c2 };
		}
		return { r1: range.r1, c1: Math.min(range.c1, tc), r2: range.r2, c2: Math.max(range.c2, tc) };
	}
	function startFillDrag(e: PointerEvent) {
		if (e.button !== 0) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		filling = true;
		const src: Rect = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
		const move = (ev: PointerEvent) => {
			const t = cellAtPoint(ev.clientX, ev.clientY);
			if (t) {
				fillDest = computeFillDest(t.r, t.c);
			}
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			filling = false;
			const dest = fillDest;
			fillDest = null;
			if (dest) {
				mutate(() => fillRange(sheet, src, dest));
				sel.fr = dest.r1;
				sel.fc = dest.c1;
				sel.ar = dest.r2;
				sel.ac = dest.c2;
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	function fillToEdge() {
		const probeCol =
			range.c1 > 0 ? range.c1 - 1 : range.c2 + 1 <= sheet.cols - 1 ? range.c2 + 1 : range.c1;
		let edge = range.r2;
		for (let r = range.r2 + 1; r < sheet.rows; r++) {
			if (getRaw(sheet, r, probeCol).trim() === '') {
				break;
			}
			edge = r;
		}
		if (edge > range.r2) {
			const src: Rect = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
			mutate(() => fillRange(sheet, src, { r1: range.r1, c1: range.c1, r2: edge, c2: range.c2 }));
			sel.fr = range.r1;
			sel.fc = range.c1;
			sel.ar = edge;
			sel.ac = range.c2;
		}
	}

	// =====================================================================
	// extra formatting setters (fonts, size, valign, indent, decimals, borders)
	// =====================================================================
	function setFont(font: string) {
		setFmt({ font });
		fontMenuOpen = false;
	}
	function setSize(size: number) {
		setFmt({ size });
		sizeMenuOpen = false;
	}
	function bumpSize(delta: number) {
		const cur = activeFmt.size ?? DEFAULT_FONT_SIZE;
		setFmt({ size: Math.min(96, Math.max(6, cur + delta)) });
	}
	function setValign(valign: VAlign) {
		setFmt({ valign });
	}
	function bumpIndent(delta: number) {
		const cur = activeFmt.indent ?? 0;
		setFmt({ indent: Math.min(MAX_INDENT, Math.max(0, cur + delta)) });
	}
	function currentDecimals(): number {
		if (typeof activeFmt.decimals === 'number') {
			return activeFmt.decimals;
		}
		return activeFmt.numFmt === 'integer' ? 0 : 2;
	}
	function bumpDecimals(delta: number) {
		setFmt({ decimals: Math.min(10, Math.max(0, currentDecimals() + delta)) });
	}

	let borderStyle = $state<BorderStyle>('thin');
	let borderColor = $state('#6b7280');
	function patchCellBorders(
		r: number,
		c: number,
		sides: Record<string, Border | null>,
		clear: boolean
	) {
		const existing = getCell(sheet, r, c)?.f?.borders;
		const next: Record<string, Border> = clear ? {} : { ...(existing ?? {}) };
		for (const [side, val] of Object.entries(sides)) {
			if (val === null) {
				delete next[side];
			} else {
				next[side] = val;
			}
		}
		updateCellFormat(sheet, r, c, { borders: next });
	}
	function sidesFor(preset: string, r: number, c: number, border: Border): Record<string, Border> {
		const top = r === range.r1;
		const bottom = r === range.r2;
		const leftE = c === range.c1;
		const rightE = c === range.c2;
		const out: Record<string, Border> = {};
		const set = (cond: boolean, side: string) => {
			if (cond) {
				out[side] = border;
			}
		};
		if (preset === 'all') {
			set(true, 'top');
			set(true, 'right');
			set(true, 'bottom');
			set(true, 'left');
		} else if (preset === 'outer') {
			set(top, 'top');
			set(rightE, 'right');
			set(bottom, 'bottom');
			set(leftE, 'left');
		} else if (preset === 'inner') {
			set(!rightE, 'right');
			set(!bottom, 'bottom');
		} else if (preset === 'innerH') {
			set(!bottom, 'bottom');
		} else if (preset === 'innerV') {
			set(!rightE, 'right');
		} else if (preset === 'top') {
			set(top, 'top');
		} else if (preset === 'bottom') {
			set(bottom, 'bottom');
		} else if (preset === 'left') {
			set(leftE, 'left');
		} else if (preset === 'right') {
			set(rightE, 'right');
		}
		return out;
	}
	function applyBorders(preset: string) {
		bordersMenuOpen = false;
		const border: Border = { style: borderStyle, color: borderColor };
		mutate(() => {
			forEachInRange((r, c) => {
				if (preset === 'none') {
					patchCellBorders(r, c, {}, true);
					return;
				}
				const sides = sidesFor(preset, r, c, border);
				if (Object.keys(sides).length > 0) {
					patchCellBorders(r, c, sides, false);
				}
			});
		});
	}

	// =====================================================================
	// merge / structural ops / freeze
	// =====================================================================
	const selectionMerged = $derived.by(() => {
		void rev;
		return findMerge(sheet, sel.ar, sel.ac) !== null;
	});
	function doMerge() {
		if (range.r1 === range.r2 && range.c1 === range.c2) {
			return;
		}
		const r1 = range.r1;
		const c1 = range.c1;
		mutate(() => mergeCells(sheet, range.r1, range.c1, range.r2, range.c2));
		setActive(r1, c1, false);
	}
	function doUnmerge() {
		mutate(() => unmergeRange(sheet, range.r1, range.c1, range.r2, range.c2));
	}
	function toggleMerge() {
		if (selectionMerged) {
			doUnmerge();
		} else {
			doMerge();
		}
	}

	function insertRowsAbove() {
		const count = range.r2 - range.r1 + 1;
		mutate(() => insertRows(sheet, range.r1, count));
		closeCtx();
	}
	function insertRowsBelow() {
		const count = range.r2 - range.r1 + 1;
		mutate(() => insertRows(sheet, range.r2 + 1, count));
		closeCtx();
	}
	function deleteSelRows() {
		const count = range.r2 - range.r1 + 1;
		mutate(() => deleteRows(sheet, range.r1, count));
		clampSelection();
		closeCtx();
	}
	function insertColsLeft() {
		const count = range.c2 - range.c1 + 1;
		mutate(() => insertCols(sheet, range.c1, count));
		closeCtx();
	}
	function insertColsRight() {
		const count = range.c2 - range.c1 + 1;
		mutate(() => insertCols(sheet, range.c2 + 1, count));
		closeCtx();
	}
	function deleteSelCols() {
		const count = range.c2 - range.c1 + 1;
		mutate(() => deleteCols(sheet, range.c1, count));
		clampSelection();
		closeCtx();
	}

	function freezeRowsToSel() {
		const n = sel.ar + 1;
		mutate(() => {
			sheet.frozenRows = sheet.frozenRows === n ? 0 : n;
		});
		closeCtx();
	}
	function freezeColsToSel() {
		const n = sel.ac + 1;
		mutate(() => {
			sheet.frozenCols = sheet.frozenCols === n ? 0 : n;
		});
		closeCtx();
	}
	function unfreezeAll() {
		mutate(() => {
			sheet.frozenRows = 0;
			sheet.frozenCols = 0;
		});
		closeCtx();
	}

	// =====================================================================
	// fill down / right / selection
	// =====================================================================
	function fillDown() {
		if (range.r1 === range.r2) {
			return;
		}
		const src: Rect = { r1: range.r1, c1: range.c1, r2: range.r1, c2: range.c2 };
		mutate(() => fillRange(sheet, src, { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 }));
	}
	function fillRight() {
		if (range.c1 === range.c2) {
			return;
		}
		const src: Rect = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c1 };
		mutate(() => fillRange(sheet, src, { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 }));
	}
	function fillSelectionWith(value: string) {
		const baseR = sel.ar;
		const baseC = sel.ac;
		const rect = editRange ?? { r1: sel.ar, c1: sel.ac, r2: sel.ar, c2: sel.ac };
		mutate(() => {
			for (let r = rect.r1; r <= rect.r2; r++) {
				for (let c = rect.c1; c <= rect.c2; c++) {
					const v = value.startsWith('=') ? translateFormula(value, r - baseR, c - baseC) : value;
					setCellRaw(sheet, r, c, v);
				}
			}
		});
		// Re-show the filled block as the selection.
		sel.fr = rect.r1;
		sel.fc = rect.c1;
		sel.ar = rect.r2;
		sel.ac = rect.c2;
	}

	// =====================================================================
	// full-format helpers (paste-special, painter, clear)
	// =====================================================================
	function cloneFmt(f: CellFormat | null): CellFormat | null {
		return f ? JSON.parse(JSON.stringify(f)) : null;
	}
	function setFullFormat(r: number, c: number, f: CellFormat | null) {
		const key = cellKey(r, c);
		const cell = sheet.cells[key];
		if (f) {
			const cloned = cloneFmt(f);
			if (cell) {
				if (cloned) {
					cell.f = cloned;
				}
			} else if (cloned) {
				sheet.cells[key] = { v: '', f: cloned };
			}
		} else if (cell) {
			delete cell.f;
			if (cell.v === '') {
				delete sheet.cells[key];
			}
		}
	}

	// =====================================================================
	// context-menu clipboard (internal, so it works without grid focus)
	// =====================================================================
	function copySelection() {
		captureClipboard();
		const tsv = rangeTsv();
		lastCopyText = tsv;
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			navigator.clipboard.writeText(tsv).catch(() => {});
		}
		closeCtx();
	}
	function cutSelection() {
		copySelection();
		mutate(() => clearRangeContents(sheet, range.r1, range.c1, range.r2, range.c2));
	}
	function pasteInternal() {
		const clip = clipboard;
		if (!clip) {
			closeCtx();
			return;
		}
		const baseR = sel.ar;
		const baseC = sel.ac;
		const dRow = baseR - clip.r1;
		const dCol = baseC - clip.c1;
		mutate(() => {
			for (let i = 0; i < clip.cells.length; i++) {
				for (let j = 0; j < clip.cells[i].length; j++) {
					const src = clip.cells[i][j];
					const value = src.v.startsWith('=') ? translateFormula(src.v, dRow, dCol) : src.v;
					setCellRaw(sheet, baseR + i, baseC + j, value);
					setFullFormat(baseR + i, baseC + j, src.f ?? null);
				}
			}
		});
		closeCtx();
	}

	// =====================================================================
	// paste special
	// =====================================================================
	function pasteSpecial(mode: 'values' | 'format' | 'formulas') {
		pasteMenuOpen = false;
		const clip = clipboard;
		if (!clip) {
			return;
		}
		const baseR = sel.ar;
		const baseC = sel.ac;
		const dRow = baseR - clip.r1;
		const dCol = baseC - clip.c1;
		mutate(() => {
			for (let i = 0; i < clip.cells.length; i++) {
				for (let j = 0; j < clip.cells[i].length; j++) {
					const src = clip.cells[i][j];
					const destR = baseR + i;
					const destC = baseC + j;
					if (mode === 'format') {
						setFullFormat(destR, destC, src.f ?? null);
					} else if (mode === 'values') {
						setCellRaw(sheet, destR, destC, src.display);
					} else {
						const v = src.v.startsWith('=') ? translateFormula(src.v, dRow, dCol) : src.v;
						setCellRaw(sheet, destR, destC, v);
					}
				}
			}
		});
		closeCtx();
	}

	// =====================================================================
	// format painter
	// =====================================================================
	let painter = $state<CellFormat | null>(null);
	let painterLock = $state(false);
	function armPainter(lock: boolean) {
		painter = cloneFmt(getCell(sheet, sel.ar, sel.ac)?.f ?? null);
		painterLock = lock;
	}
	function applyPainter() {
		const f = painter;
		if (!f) {
			return;
		}
		mutate(() => forEachInRange((r, c) => setFullFormat(r, c, f)));
		if (!painterLock) {
			painter = null;
		}
	}

	// =====================================================================
	// find & replace
	// =====================================================================
	let findOpen = $state(false);
	let findText = $state('');
	let replaceText = $state('');
	let matchCase = $state(false);
	let matches = $state<{ r: number; c: number }[]>([]);
	let matchIdx = $state(-1);

	function runFind() {
		const q = findText;
		const res: { r: number; c: number }[] = [];
		if (q) {
			const needle = matchCase ? q : q.toLowerCase();
			for (const [key, cell] of Object.entries(sheet.cells)) {
				const pos = parseKey(key);
				if (!pos || cell.v === '') {
					continue;
				}
				const hay = matchCase ? cell.v : cell.v.toLowerCase();
				if (hay.includes(needle)) {
					res.push({ r: pos.row, c: pos.col });
				}
			}
			res.sort((a, b) => a.r - b.r || a.c - b.c);
		}
		matches = res;
		matchIdx = res.length > 0 ? 0 : -1;
		if (matchIdx >= 0) {
			setActive(res[0].r, res[0].c, false);
		}
	}
	function stepMatch(delta: number) {
		if (matches.length === 0) {
			return;
		}
		matchIdx = (matchIdx + delta + matches.length) % matches.length;
		setActive(matches[matchIdx].r, matches[matchIdx].c, false);
	}
	function replaceInString(s: string, find: string, repl: string): string {
		if (!find) {
			return s;
		}
		if (matchCase) {
			return s.split(find).join(repl);
		}
		const lower = s.toLowerCase();
		const fl = find.toLowerCase();
		let out = '';
		let i = 0;
		let idx = lower.indexOf(fl, i);
		while (idx !== -1) {
			out += s.slice(i, idx) + repl;
			i = idx + find.length;
			idx = lower.indexOf(fl, i);
		}
		return out + s.slice(i);
	}
	function replaceCurrent() {
		if (matchIdx < 0 || matchIdx >= matches.length) {
			return;
		}
		const m = matches[matchIdx];
		const next = replaceInString(getRaw(sheet, m.r, m.c), findText, replaceText);
		mutate(() => setCellRaw(sheet, m.r, m.c, next));
		runFind();
	}
	function replaceAll() {
		const targets = [...matches];
		mutate(() => {
			for (const m of targets) {
				setCellRaw(
					sheet,
					m.r,
					m.c,
					replaceInString(getRaw(sheet, m.r, m.c), findText, replaceText)
				);
			}
		});
		runFind();
	}
	function openFind() {
		findOpen = true;
		queueMicrotask(() => findInputEl?.focus());
	}
	let findInputEl: HTMLInputElement | null = $state(null);

	// =====================================================================
	// data-edge (Ctrl+Arrow) navigation
	// =====================================================================
	function dataEdge(dr: number, dc: number, extend: boolean) {
		const maxR = sheet.rows - 1;
		const maxC = sheet.cols - 1;
		const filled = (rr: number, cc: number) => getRaw(sheet, rr, cc).trim() !== '';
		let r = sel.ar;
		let c = sel.ac;
		const inB = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr <= maxR && cc <= maxC;
		if (!inB(r + dr, c + dc)) {
			setActive(r, c, extend);
			return;
		}
		if (filled(r, c) && filled(r + dr, c + dc)) {
			while (inB(r + dr, c + dc) && filled(r + dr, c + dc)) {
				r += dr;
				c += dc;
			}
		} else {
			r += dr;
			c += dc;
			while (inB(r + dr, c + dc) && !filled(r, c)) {
				r += dr;
				c += dc;
			}
		}
		setActive(r, c, extend);
	}

	// =====================================================================
	// right-click context menu
	// =====================================================================
	let ctx = $state<{ x: number; y: number; kind: 'cell' | 'col' | 'row' } | null>(null);
	function openCellCtx(e: MouseEvent, r: number, c: number) {
		e.preventDefault();
		if (!inRange(r, c)) {
			setActive(r, c, false);
		}
		ctx = { x: e.clientX, y: e.clientY, kind: 'cell' };
	}
	function openColCtx(e: MouseEvent, c: number) {
		e.preventDefault();
		if (!(c >= range.c1 && c <= range.c2)) {
			selectColumn(c, false);
		}
		ctx = { x: e.clientX, y: e.clientY, kind: 'col' };
	}
	function openRowCtx(e: MouseEvent, r: number) {
		e.preventDefault();
		if (!(r >= range.r1 && r <= range.r2)) {
			selectRow(r, false);
		}
		ctx = { x: e.clientX, y: e.clientY, kind: 'row' };
	}
	function closeCtx() {
		ctx = null;
	}
	function ctxClear(all: boolean) {
		mutate(() => {
			if (all) {
				clearRangeAll(sheet, range.r1, range.c1, range.r2, range.c2);
			} else {
				clearRangeContents(sheet, range.r1, range.c1, range.r2, range.c2);
			}
		});
		closeCtx();
	}

	// =====================================================================
	// sort
	// =====================================================================
	function sortByActiveColumn(asc: boolean) {
		const c1 = range.c1;
		const c2 = range.c2;
		const r1 = range.r1;
		const r2 = range.r2;
		const keyCol = sel.ac;
		mutate(() => {
			// Snapshot each row's raw cells (v + f) so whole rows move together.
			type RowCells = { v: string; f: CellFormat | null }[];
			const block: RowCells[] = [];
			for (let r = r1; r <= r2; r++) {
				const line: RowCells = [];
				for (let c = c1; c <= c2; c++) {
					const cell = getCell(sheet, r, c);
					line.push({ v: cell?.v ?? '', f: cell?.f ? cloneFmt(cell.f) : null });
				}
				block.push(line);
			}
			const keyIdx = keyCol - c1;
			const sortKey = (line: RowCells) => {
				const raw = line[keyIdx]?.v ?? '';
				const num = Number(raw);
				return { raw, num: raw !== '' && Number.isFinite(num) ? num : null };
			};
			block.sort((a, b) => {
				const ka = sortKey(a);
				const kb = sortKey(b);
				let cmp: number;
				if (ka.num !== null && kb.num !== null) {
					cmp = ka.num - kb.num;
				} else {
					cmp =
						ka.raw.toLowerCase() < kb.raw.toLowerCase()
							? -1
							: ka.raw.toLowerCase() > kb.raw.toLowerCase()
								? 1
								: 0;
				}
				return asc ? cmp : -cmp;
			});
			for (let i = 0; i < block.length; i++) {
				for (let j = 0; j < block[i].length; j++) {
					const cellData = block[i][j];
					setCellRaw(sheet, r1 + i, c1 + j, cellData.v);
					setFullFormat(r1 + i, c1 + j, cellData.f);
				}
			}
		});
		closeCtx();
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
		<button
			type="button"
			class="tb-btn"
			class:on={!!painter}
			title="Paint format — double-click to keep painting"
			aria-label="Format painter"
			onclick={() => armPainter(false)}
			ondblclick={() => armPainter(true)}
		>
			<Icon name="copy" size={13} />
		</button>
		<button
			type="button"
			class="tb-btn"
			title="Find & replace (⌘F)"
			aria-label="Find"
			onclick={openFind}
		>
			<Icon name="search" size={13} />
		</button>
		<span class="tb-sep"></span>

		<!-- font family -->
		<div class="font-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn font-trigger"
				title="Font"
				onclick={() => (fontMenuOpen = !fontMenuOpen)}
			>
				<span class="font-name">{activeFmt.font ?? 'Default'}</span>
				<Icon name="chevron-down" size={10} />
			</button>
			{#if fontMenuOpen}
				<div class="dropdown font-menu" role="menu">
					{#each FONT_FAMILIES as fam (fam)}
						<button
							type="button"
							class="dd-item"
							class:active={(activeFmt.font ?? 'Default') === fam}
							style={fam === 'Default' ? '' : `font-family:${fontStack(fam)}`}
							onclick={() => setFont(fam)}
						>
							{fam}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- font size -->
		<div class="size-group">
			<button
				type="button"
				class="tb-btn mini"
				title="Decrease font size"
				aria-label="Decrease font size"
				onclick={() => bumpSize(-1)}>−</button
			>
			<div class="size-wrap menu-wrap">
				<button
					type="button"
					class="tb-btn size-trigger"
					title="Font size"
					onclick={() => (sizeMenuOpen = !sizeMenuOpen)}
				>
					{activeFmt.size ?? DEFAULT_FONT_SIZE}
				</button>
				{#if sizeMenuOpen}
					<div class="dropdown size-menu" role="menu">
						{#each FONT_SIZES as sz (sz)}
							<button
								type="button"
								class="dd-item"
								class:active={(activeFmt.size ?? DEFAULT_FONT_SIZE) === sz}
								onclick={() => setSize(sz)}
							>
								{sz}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<button
				type="button"
				class="tb-btn mini"
				title="Increase font size"
				aria-label="Increase font size"
				onclick={() => bumpSize(1)}>+</button
			>
		</div>
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

		<!-- borders -->
		<div class="borders-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn"
				title="Borders"
				aria-label="Borders"
				onclick={() => (bordersMenuOpen = !bordersMenuOpen)}
			>
				<span class="brd-glyph">⊞</span><Icon name="chevron-down" size={10} />
			</button>
			{#if bordersMenuOpen}
				<div class="dropdown borders-menu" role="menu">
					<div class="brd-grid">
						{#each BORDER_PRESETS as p (p.key)}
							<button
								type="button"
								class="brd-btn"
								title={p.label}
								aria-label={p.label}
								onclick={() => applyBorders(p.key)}>{p.glyph}</button
							>
						{/each}
					</div>
					<div class="brd-row">
						<span class="brd-lbl">Style</span>
						<div class="brd-styles">
							{#each BORDER_STYLE_OPTS as st (st)}
								<button
									type="button"
									class="brd-style"
									class:sel={borderStyle === st}
									title={st}
									onclick={() => (borderStyle = st)}
								>
									<span class="brd-style-line {st}"></span>
								</button>
							{/each}
						</div>
					</div>
					<div class="brd-row">
						<span class="brd-lbl">Color</span>
						<div class="brd-colors">
							{#each SWATCHES as sw (sw)}
								<button
									type="button"
									class="swatch sm"
									class:sel={borderColor === sw}
									style="background:{sw}"
									aria-label={sw}
									onclick={() => (borderColor = sw)}
								></button>
							{/each}
						</div>
					</div>
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

		<!-- vertical align -->
		<div class="valign-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn"
				title="Vertical align"
				aria-label="Vertical align"
				onclick={() => (valignMenuOpen = !valignMenuOpen)}
			>
				<span class="valign-glyph {activeFmt.valign ?? 'middle'}"></span><Icon
					name="chevron-down"
					size={10}
				/>
			</button>
			{#if valignMenuOpen}
				<div class="dropdown valign-menu" role="menu">
					<button
						type="button"
						class="dd-item"
						class:active={activeFmt.valign === 'top'}
						onclick={() => {
							setValign('top');
							valignMenuOpen = false;
						}}>Top</button
					>
					<button
						type="button"
						class="dd-item"
						class:active={(activeFmt.valign ?? 'middle') === 'middle'}
						onclick={() => {
							setValign('middle');
							valignMenuOpen = false;
						}}>Middle</button
					>
					<button
						type="button"
						class="dd-item"
						class:active={activeFmt.valign === 'bottom'}
						onclick={() => {
							setValign('bottom');
							valignMenuOpen = false;
						}}>Bottom</button
					>
				</div>
			{/if}
		</div>

		<button
			type="button"
			class="tb-btn"
			title="Decrease indent"
			aria-label="Decrease indent"
			onclick={() => bumpIndent(-1)}
		>
			<span class="indent-glyph dec"></span>
		</button>
		<button
			type="button"
			class="tb-btn"
			title="Increase indent"
			aria-label="Increase indent"
			onclick={() => bumpIndent(1)}
		>
			<span class="indent-glyph inc"></span>
		</button>

		<button
			type="button"
			class="tb-btn"
			class:on={selectionMerged}
			title="Merge cells"
			aria-label="Merge cells"
			onclick={toggleMerge}
		>
			<span class="merge-glyph"></span>
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

		<button
			type="button"
			class="tb-btn dec-btn"
			title="Decrease decimal places"
			aria-label="Decrease decimals"
			onclick={() => bumpDecimals(-1)}
		>
			.0<span class="dec-arrow">←</span>
		</button>
		<button
			type="button"
			class="tb-btn dec-btn"
			title="Increase decimal places"
			aria-label="Increase decimals"
			onclick={() => bumpDecimals(1)}
		>
			.00<span class="dec-arrow">→</span>
		</button>

		<span class="tb-sep"></span>

		<div class="paste-wrap menu-wrap">
			<button
				type="button"
				class="tb-btn text"
				title="Paste special"
				disabled={!clipboard}
				onclick={() => (pasteMenuOpen = !pasteMenuOpen)}
			>
				Paste <Icon name="chevron-down" size={10} />
			</button>
			{#if pasteMenuOpen}
				<div class="dropdown paste-menu" role="menu">
					<button type="button" class="dd-item" onclick={() => pasteSpecial('values')}
						>Values only</button
					>
					<button type="button" class="dd-item" onclick={() => pasteSpecial('formulas')}
						>Formulas only</button
					>
					<button type="button" class="dd-item" onclick={() => pasteSpecial('format')}
						>Formatting only</button
					>
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
						class:frozen-edge={c === sheet.frozenCols - 1}
						style="width:{colWidth(sheet, c)}px;{c < sheet.frozenCols
							? `position:sticky;left:${leftOf(c)}px;z-index:5;`
							: ''}"
					>
						<button
							type="button"
							class="col-head-label"
							onpointerdown={(e) => selectColumn(c, e.shiftKey)}
							oncontextmenu={(e) => openColCtx(e, c)}
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
						class:frozen-edge={r === sheet.frozenRows - 1}
						style="width:{HEADER_WIDTH}px;{r < sheet.frozenRows
							? `position:sticky;top:${topOf(r)}px;z-index:9;`
							: ''}"
					>
						<button
							type="button"
							class="row-head-label"
							onpointerdown={(e) => selectRow(r, e.shiftKey)}
							oncontextmenu={(e) => openRowCtx(e, r)}
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
						{@const merged = isCovered(sheet, r, c) || isMergeAnchor(sheet, r, c)}
						<div
							class="cell"
							class:active={isActive && !merged}
							class:selected={inRange(r, c)}
							class:merged
							class:frozen-col-edge={c === sheet.frozenCols - 1}
							class:frozen-row-edge={r === sheet.frozenRows - 1}
							role="gridcell"
							tabindex="-1"
							aria-selected={inRange(r, c)}
							data-r={r}
							data-c={c}
							style={cellStyle(r, c)}
							onpointerdown={(e) => onCellPointerDown(e, r, c)}
							onpointerenter={() => onCellPointerEnter(r, c)}
							ondblclick={() => startEdit(r, c)}
							oncontextmenu={(e) => openCellCtx(e, r, c)}
						>
							{#if isEditing && !merged}
								<input
									class="cell-input"
									type="text"
									bind:value={editValue}
									onkeydown={onEditorKeydown}
									onpointerdown={(e) => e.stopPropagation()}
									spellcheck="false"
									{@attach editorAttach}
								/>
							{:else if !merged}
								<span class="cell-text">{engine.display(sheet.id, r, c)}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/each}

			<!-- merged-cell overlays (handle content + editing for any merge shape) -->
			{#each mergeBlocks as mb (mb.m.r1 + ':' + mb.m.c1)}
				{@const ar = mb.m.r1}
				{@const ac = mb.m.c1}
				{@const isActiveM = sel.ar === ar && sel.ac === ac}
				{@const isEditingM = editing?.r === ar && editing?.c === ac}
				<div
					class="merge-cell"
					class:active={isActiveM}
					class:selected={inRange(ar, ac)}
					role="gridcell"
					tabindex="-1"
					data-r={ar}
					data-c={ac}
					style="left:{mb.left}px;top:{mb.top}px;width:{mb.width}px;height:{mb.height}px;{formatCss(
						getCell(sheet, ar, ac)?.f ?? null
					)}"
					onpointerdown={(e) => onCellPointerDown(e, ar, ac)}
					onpointerenter={() => onCellPointerEnter(ar, ac)}
					ondblclick={() => startEdit(ar, ac)}
					oncontextmenu={(e) => openCellCtx(e, ar, ac)}
				>
					{#if isEditingM}
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
						<span class="cell-text">{engine.display(sheet.id, ar, ac)}</span>
					{/if}
				</div>
			{/each}

			<!-- fill preview while dragging the fill handle -->
			{#if filling && fillDest}
				<div
					class="fill-preview"
					style="left:{leftOf(fillDest.c1)}px;top:{topOf(fillDest.r1)}px;width:{leftOf(
						fillDest.c2 + 1
					) - leftOf(fillDest.c1)}px;height:{topOf(fillDest.r2 + 1) - topOf(fillDest.r1)}px"
				></div>
			{/if}

			<!-- fill handle at the bottom-right of the selection -->
			{#if !editing && !filling}
				<div
					class="fill-handle"
					style="left:{fillHandle.left}px;top:{fillHandle.top}px"
					role="button"
					tabindex="-1"
					aria-label="Fill handle"
					title="Drag to fill · double-click to fill down"
					onpointerdown={startFillDrag}
					ondblclick={fillToEdge}
				></div>
			{/if}
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

	<!-- find & replace -->
	{#if findOpen}
		<div class="find-panel" role="dialog" aria-label="Find and replace">
			<div class="find-row">
				<input
					bind:this={findInputEl}
					class="find-input"
					placeholder="Find in sheet"
					bind:value={findText}
					oninput={runFind}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							stepMatch(e.shiftKey ? -1 : 1);
						} else if (e.key === 'Escape') {
							e.preventDefault();
							findOpen = false;
							gridScrollEl?.focus();
						}
					}}
				/>
				<span class="find-count">{matches.length ? `${matchIdx + 1}/${matches.length}` : '0'}</span>
				<button
					type="button"
					class="find-nav"
					title="Previous"
					aria-label="Previous match"
					onclick={() => stepMatch(-1)}>‹</button
				>
				<button
					type="button"
					class="find-nav"
					title="Next"
					aria-label="Next match"
					onclick={() => stepMatch(1)}>›</button
				>
				<button
					type="button"
					class="find-nav"
					class:on={matchCase}
					title="Match case"
					onclick={() => {
						matchCase = !matchCase;
						runFind();
					}}>Aa</button
				>
				<button
					type="button"
					class="find-nav"
					title="Close"
					aria-label="Close find"
					onclick={() => {
						findOpen = false;
						gridScrollEl?.focus();
					}}>✕</button
				>
			</div>
			<div class="find-row">
				<input class="find-input" placeholder="Replace with" bind:value={replaceText} />
				<button type="button" class="find-btn" onclick={replaceCurrent} disabled={matchIdx < 0}
					>Replace</button
				>
				<button type="button" class="find-btn" onclick={replaceAll} disabled={matches.length === 0}
					>All</button
				>
			</div>
		</div>
	{/if}

	<!-- right-click context menu -->
	{#if ctx}
		<div class="ctx-menu" role="menu" style="left:{ctx.x}px;top:{ctx.y}px">
			<button type="button" class="ctx-item" onclick={cutSelection}>Cut</button>
			<button type="button" class="ctx-item" onclick={copySelection}>Copy</button>
			{#if clipboard}
				<button type="button" class="ctx-item" onclick={pasteInternal}>Paste</button>
				<button type="button" class="ctx-item" onclick={() => pasteSpecial('values')}
					>Paste values only</button
				>
				<button type="button" class="ctx-item" onclick={() => pasteSpecial('format')}
					>Paste format only</button
				>
			{/if}
			<div class="ctx-sep"></div>
			{#if ctx.kind !== 'col'}
				<button type="button" class="ctx-item" onclick={insertRowsAbove}
					>Insert row{range.r2 > range.r1 ? 's' : ''} above</button
				>
				<button type="button" class="ctx-item" onclick={insertRowsBelow}
					>Insert row{range.r2 > range.r1 ? 's' : ''} below</button
				>
				<button type="button" class="ctx-item danger" onclick={deleteSelRows}
					>Delete row{range.r2 > range.r1 ? 's' : ''}</button
				>
			{/if}
			{#if ctx.kind !== 'row'}
				<button type="button" class="ctx-item" onclick={insertColsLeft}
					>Insert column{range.c2 > range.c1 ? 's' : ''} left</button
				>
				<button type="button" class="ctx-item" onclick={insertColsRight}
					>Insert column{range.c2 > range.c1 ? 's' : ''} right</button
				>
				<button type="button" class="ctx-item danger" onclick={deleteSelCols}
					>Delete column{range.c2 > range.c1 ? 's' : ''}</button
				>
			{/if}
			<div class="ctx-sep"></div>
			<button
				type="button"
				class="ctx-item"
				onclick={() => {
					toggleMerge();
					closeCtx();
				}}>{selectionMerged ? 'Unmerge cells' : 'Merge cells'}</button
			>
			<button
				type="button"
				class="ctx-item"
				onclick={() => {
					sortByActiveColumn(true);
				}}>Sort range A → Z</button
			>
			<button
				type="button"
				class="ctx-item"
				onclick={() => {
					sortByActiveColumn(false);
				}}>Sort range Z → A</button
			>
			<div class="ctx-sep"></div>
			<button type="button" class="ctx-item" onclick={freezeRowsToSel}
				>{sheet.frozenRows === sel.ar + 1
					? 'Unfreeze rows'
					: `Freeze up to row ${sel.ar + 1}`}</button
			>
			<button type="button" class="ctx-item" onclick={freezeColsToSel}
				>{sheet.frozenCols === sel.ac + 1
					? 'Unfreeze columns'
					: `Freeze up to column ${colToLetter(sel.ac)}`}</button
			>
			{#if sheet.frozenRows > 0 || sheet.frozenCols > 0}
				<button type="button" class="ctx-item" onclick={unfreezeAll}>Unfreeze all</button>
			{/if}
			<div class="ctx-sep"></div>
			<button type="button" class="ctx-item" onclick={() => ctxClear(false)}>Clear contents</button>
			<button type="button" class="ctx-item" onclick={() => ctxClear(true)}>Clear all</button>
		</div>
	{/if}
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
		/* Drag selects cells, not the text inside them. The cell editor <input>
		   re-enables text selection for itself. */
		user-select: none;
		-webkit-user-select: none;
	}
	.cell-input {
		user-select: text;
		-webkit-user-select: text;
	}
	.grid-scroll.resizing {
		user-select: none;
		cursor: col-resize;
	}
	.grid {
		position: relative;
		min-width: 100%;
	}

	/* ---- toolbar additions ---- */
	.tb-btn.mini {
		min-width: 18px;
		padding: 0 3px;
		font-size: 14px;
		font-weight: 600;
	}
	.size-group {
		display: inline-flex;
		align-items: center;
		gap: 1px;
	}
	.font-trigger {
		gap: 4px;
		min-width: 78px;
		justify-content: space-between;
		padding: 0 6px;
	}
	.font-name {
		max-width: 64px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
	}
	.size-trigger {
		min-width: 30px;
		font-variant-numeric: tabular-nums;
		font-size: 12px;
	}
	.dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 60;
		min-width: 140px;
		max-height: 280px;
		overflow-y: auto;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-medium);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.size-menu {
		min-width: 56px;
	}
	.dd-item {
		display: flex;
		align-items: center;
		padding: 6px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
	}
	.dd-item:hover {
		background: var(--accents-1);
	}
	.dd-item.active {
		background: var(--accent-soft, var(--accents-2));
	}

	.brd-glyph {
		font-size: 14px;
		line-height: 1;
	}
	.borders-menu {
		min-width: 160px;
		padding: 8px;
		gap: 8px;
	}
	.brd-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 3px;
	}
	.brd-btn {
		width: 28px;
		height: 26px;
		font-size: 14px;
		color: var(--accents-7);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 5px;
		cursor: pointer;
	}
	.brd-btn:hover {
		background: var(--surface);
		border-color: var(--accents-3);
	}
	.brd-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.brd-lbl {
		font-size: 11px;
		color: var(--accents-5);
		min-width: 36px;
	}
	.brd-styles {
		display: flex;
		gap: 2px;
	}
	.brd-style {
		width: 26px;
		height: 22px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 4px;
		cursor: pointer;
	}
	.brd-style.sel {
		border-color: var(--accent, var(--geist-foreground));
		background: var(--accent-soft, var(--accents-2));
	}
	.brd-style-line {
		width: 18px;
		height: 0;
		border-top: 2px solid var(--fg);
	}
	.brd-style-line.thin {
		border-top-width: 1px;
	}
	.brd-style-line.medium {
		border-top-width: 2px;
	}
	.brd-style-line.thick {
		border-top-width: 3px;
	}
	.brd-style-line.dashed {
		border-top-style: dashed;
	}
	.brd-style-line.dotted {
		border-top-style: dotted;
	}
	.brd-style-line.double {
		border-top-style: double;
		border-top-width: 3px;
	}
	.brd-colors {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
	}
	.swatch.sm {
		width: 16px;
		height: 16px;
	}
	.swatch.sel {
		outline: 2px solid var(--accent, var(--geist-foreground));
		outline-offset: 1px;
	}

	.valign-glyph {
		position: relative;
		display: inline-block;
		width: 13px;
		height: 13px;
		border: 1.5px solid currentColor;
		border-radius: 2px;
	}
	.valign-glyph::after {
		content: '';
		position: absolute;
		left: 2px;
		right: 2px;
		height: 1.6px;
		background: currentColor;
	}
	.valign-glyph.top::after {
		top: 2px;
	}
	.valign-glyph.middle::after {
		top: 50%;
		transform: translateY(-50%);
	}
	.valign-glyph.bottom::after {
		bottom: 2px;
	}
	.indent-glyph {
		position: relative;
		display: inline-block;
		width: 15px;
		height: 11px;
	}
	.indent-glyph::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1.6px;
		background: currentColor;
	}
	.indent-glyph.dec::before {
		right: 0;
	}
	.indent-glyph.inc::before {
		left: 0;
	}
	.indent-glyph::after {
		content: '▸';
		position: absolute;
		top: 50%;
		left: 4px;
		transform: translateY(-50%);
		font-size: 8px;
	}
	.indent-glyph.dec::after {
		content: '◂';
	}
	.merge-glyph {
		position: relative;
		display: inline-block;
		width: 14px;
		height: 12px;
		border: 1.5px solid currentColor;
		border-radius: 2px;
	}
	.merge-glyph::after {
		content: '';
		position: absolute;
		top: 1px;
		bottom: 1px;
		left: 50%;
		width: 1.5px;
		background: var(--surface);
	}
	.dec-btn {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		gap: 0;
	}
	.dec-arrow {
		font-size: 9px;
		margin-left: 1px;
	}

	/* ---- fill handle + preview ---- */
	.fill-handle {
		position: absolute;
		width: 8px;
		height: 8px;
		transform: translate(-50%, -50%);
		background: var(--accent, #3b82f6);
		border: 1px solid var(--surface);
		border-radius: 1px;
		cursor: crosshair;
		z-index: 8;
	}
	.fill-preview {
		position: absolute;
		pointer-events: none;
		border: 2px dashed var(--accent, #3b82f6);
		background: color-mix(in srgb, var(--accent, #3b82f6) 6%, transparent);
		z-index: 7;
		box-sizing: border-box;
	}

	/* ---- merged cell overlay ---- */
	.merge-cell {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: flex-start;
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
		/* Above normal cells (0) but below the sticky header gutters (8–11). */
		z-index: 1;
	}
	.merge-cell.selected {
		background: color-mix(in srgb, var(--accent, #3b82f6) 12%, var(--surface));
	}
	.merge-cell.active {
		box-shadow: inset 0 0 0 2px var(--accent, #3b82f6);
		z-index: 3;
	}

	/* ---- frozen pane edges ---- */
	.col-head.frozen-edge,
	.cell.frozen-col-edge {
		border-right: 1.5px solid var(--accents-4);
	}
	.row-head.frozen-edge,
	.cell.frozen-row-edge {
		border-bottom: 1.5px solid var(--accents-4);
	}

	/* ---- find & replace ---- */
	.find-panel {
		position: absolute;
		top: 96px;
		right: 18px;
		z-index: 70;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-medium);
	}
	.find-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.find-input {
		width: 180px;
		padding: 5px 8px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		outline: none;
	}
	.find-input:focus {
		border-color: var(--accent, var(--border-strong));
	}
	.find-count {
		min-width: 34px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--accents-5);
		text-align: center;
	}
	.find-nav {
		min-width: 26px;
		height: 26px;
		font: inherit;
		font-size: 13px;
		color: var(--accents-6);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.find-nav:hover {
		background: var(--accents-1);
	}
	.find-nav.on {
		background: var(--accent-soft, var(--accents-2));
		color: var(--accent, var(--geist-foreground));
	}
	.find-btn {
		padding: 5px 10px;
		font: inherit;
		font-size: 12px;
		color: var(--geist-foreground);
		background: var(--accents-1);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.find-btn:hover:not(:disabled) {
		background: var(--surface);
	}
	.find-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ---- context menu ---- */
	.ctx-menu {
		position: fixed;
		z-index: 80;
		min-width: 190px;
		max-height: 88vh;
		overflow-y: auto;
		padding: 4px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-medium);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.ctx-item {
		display: flex;
		align-items: center;
		padding: 7px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--geist-foreground);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
	}
	.ctx-item:hover {
		background: var(--accents-1);
	}
	.ctx-item.danger:hover {
		color: var(--geist-error);
		background: rgba(238, 0, 0, 0.08);
	}
	.ctx-sep {
		height: 1px;
		margin: 4px 2px;
		background: var(--border);
	}
	.col-headers {
		display: flex;
		position: sticky;
		top: 0;
		/* Above every frozen data cell (max 6) and the row gutter (8/9). */
		z-index: 10;
		height: 26px;
	}
	.corner {
		position: sticky;
		left: 0;
		z-index: 11;
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
		/* Above frozen data cells (max 6) and merge overlays (1); below headers. */
		z-index: 8;
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
