/**
 * Pure data model + cell operations for spreadsheet ("sheet") projects.
 *
 * A sheet project stores its entire workbook in `project.scene` (JSONB) — the
 * same way whiteboards store an Excalidraw scene and todo lists store a board.
 * No extra tables. Everything here operates on plain objects so it's trivially
 * testable and importable from the server (the MCP endpoints reuse it to read
 * and write cells), with no DOM or browser-only dependency.
 *
 * A workbook is a list of `Sheet` tabs. Each sheet is a sparse grid: only the
 * cells the user actually touched are stored, keyed by `"row:col"` (both
 * 0-based). A cell holds the raw input string the user typed — a literal
 * ("hello", "42") or a formula ("=A1+B2") — plus optional formatting. Computed
 * values are derived on the fly by the formula engine (engine.ts); we never
 * persist them, so the stored scene stays the single source of truth.
 */

export type Align = 'left' | 'center' | 'right';

/**
 * How a numeric cell value is displayed. 'auto' shows numbers as-is and lets
 * the engine pick a sensible representation; the rest force a presentation.
 */
export type NumberFormat =
	| 'auto'
	| 'number'
	| 'integer'
	| 'currency'
	| 'percent'
	| 'scientific'
	| 'date'
	| 'datetime'
	| 'time'
	| 'text';

export type CellFormat = {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	align?: Align;
	/** Text color (any CSS color string). */
	color?: string;
	/** Background fill (any CSS color string). */
	bg?: string;
	numFmt?: NumberFormat;
	wrap?: boolean;
};

export type Cell = {
	/** Raw user input: a literal or a formula starting with '='. */
	v: string;
	/** Optional formatting. Omitted when the cell has no styling. */
	f?: CellFormat;
};

export type Sheet = {
	id: string;
	name: string;
	/** Logical grid extent (number of addressable rows / columns). */
	rows: number;
	cols: number;
	/** Sparse cell map keyed by `"row:col"` (0-based). */
	cells: Record<string, Cell>;
	/** Per-column width overrides in px, keyed by column index. */
	colWidths: Record<string, number>;
	/** Per-row height overrides in px, keyed by row index. */
	rowHeights: Record<string, number>;
	/** Count of frozen header rows / columns (kept pinned while scrolling). */
	frozenRows: number;
	frozenCols: number;
};

export type SheetBook = {
	version: 1;
	sheets: Sheet[];
	activeSheetId: string;
};

// ----- sizing constants (shared by the grid UI) -----

export const DEFAULT_ROWS = 60;
export const DEFAULT_COLS = 26;
export const DEFAULT_COL_WIDTH = 104;
export const DEFAULT_ROW_HEIGHT = 26;
export const MIN_COL_WIDTH = 40;
export const MAX_COL_WIDTH = 800;
export const MIN_ROW_HEIGHT = 20;
export const MAX_ROW_HEIGHT = 400;
export const HEADER_WIDTH = 46; // row-number gutter
export const MAX_ROWS = 5000;
export const MAX_COLS = 702; // up to column "ZZ"

const NUMBER_FORMATS: NumberFormat[] = [
	'auto',
	'number',
	'integer',
	'currency',
	'percent',
	'scientific',
	'date',
	'datetime',
	'time',
	'text'
];

// ----- id helper (mirrors todos/board.ts) -----

let counter = 0;
function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	counter = (counter + 1) % 1_000_000;
	const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
	return 'id-' + Math.abs(Math.floor(t * 1000)).toString(36) + counter.toString(36);
}

// ============================================================
// A1 notation
// ============================================================

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colToLetter(col: number): string {
	let n = col;
	let s = '';
	while (n >= 0) {
		s = String.fromCharCode((n % 26) + 65) + s;
		n = Math.floor(n / 26) - 1;
	}
	return s;
}

/** "A" → 0, "Z" → 25, "AA" → 26. Returns -1 for non-letters. */
export function letterToCol(letters: string): number {
	const up = letters.toUpperCase();
	let n = 0;
	for (let i = 0; i < up.length; i++) {
		const code = up.charCodeAt(i);
		if (code < 65 || code > 90) {
			return -1;
		}
		n = n * 26 + (code - 64);
	}
	return n - 1;
}

/** Key a cell by `"row:col"` (0-based). */
export function cellKey(row: number, col: number): string {
	return `${row}:${col}`;
}

/** Parse a key back to {row, col}, or null when malformed. */
export function parseKey(key: string): { row: number; col: number } | null {
	const m = /^(\d+):(\d+)$/.exec(key);
	if (!m) {
		return null;
	}
	return { row: Number(m[1]), col: Number(m[2]) };
}

export type A1Ref = { row: number; col: number; absRow: boolean; absCol: boolean };

/** Parse an A1 reference like "B3", "$A$1", "AA12". Returns null if invalid. */
export function parseA1(ref: string): A1Ref | null {
	const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref.trim());
	if (!m) {
		return null;
	}
	const col = letterToCol(m[2]);
	const row = Number(m[4]) - 1;
	if (col < 0 || row < 0) {
		return null;
	}
	return { row, col, absCol: m[1] === '$', absRow: m[3] === '$' };
}

/** Build an A1 string from 0-based row/col (e.g. 0,1 → "B1"). */
export function toA1(row: number, col: number): string {
	return `${colToLetter(col)}${row + 1}`;
}

// ============================================================
// construction
// ============================================================

export function newSheet(name = 'Sheet1', rows = DEFAULT_ROWS, cols = DEFAULT_COLS): Sheet {
	return {
		id: uid(),
		name,
		rows,
		cols,
		cells: {},
		colWidths: {},
		rowHeights: {},
		frozenRows: 0,
		frozenCols: 0
	};
}

export function createEmptyBook(): SheetBook {
	const sheet = newSheet('Sheet1');
	return { version: 1, sheets: [sheet], activeSheetId: sheet.id };
}

// ============================================================
// normalization (never trust stored JSON — could be empty / legacy / hand-edited)
// ============================================================

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.min(max, Math.max(min, Math.round(value)));
	}
	return fallback;
}

function toNumberFormat(value: unknown): NumberFormat | null {
	for (const nf of NUMBER_FORMATS) {
		if (nf === value) {
			return nf;
		}
	}
	return null;
}

function normalizeFormat(raw: unknown): CellFormat | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const f: CellFormat = {};
	if ('bold' in raw && raw.bold === true) {
		f.bold = true;
	}
	if ('italic' in raw && raw.italic === true) {
		f.italic = true;
	}
	if ('underline' in raw && raw.underline === true) {
		f.underline = true;
	}
	if ('strike' in raw && raw.strike === true) {
		f.strike = true;
	}
	if ('wrap' in raw && raw.wrap === true) {
		f.wrap = true;
	}
	if ('align' in raw && (raw.align === 'left' || raw.align === 'center' || raw.align === 'right')) {
		f.align = raw.align;
	}
	if ('color' in raw && typeof raw.color === 'string' && raw.color) {
		f.color = raw.color;
	}
	if ('bg' in raw && typeof raw.bg === 'string' && raw.bg) {
		f.bg = raw.bg;
	}
	if ('numFmt' in raw) {
		const nf = toNumberFormat(raw.numFmt);
		if (nf) {
			f.numFmt = nf;
		}
	}
	return Object.keys(f).length > 0 ? f : null;
}

function normalizeCell(raw: unknown): Cell | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const v = 'v' in raw && typeof raw.v === 'string' ? raw.v : '';
	const f = 'f' in raw ? normalizeFormat(raw.f) : null;
	// A cell with no content and no formatting is meaningless — drop it so the
	// sparse map stays tight.
	if (v === '' && !f) {
		return null;
	}
	return f ? { v, f } : { v };
}

function normalizeSizeMap(raw: unknown, min: number, max: number): Record<string, number> {
	const out: Record<string, number> = {};
	if (typeof raw !== 'object' || raw === null) {
		return out;
	}
	for (const [k, val] of Object.entries(raw)) {
		if (!/^\d+$/.test(k) || typeof val !== 'number' || !Number.isFinite(val)) {
			continue;
		}
		out[k] = Math.min(max, Math.max(min, Math.round(val)));
	}
	return out;
}

function normalizeSheet(raw: unknown): Sheet | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const cells: Record<string, Cell> = {};
	let maxRow = -1;
	let maxCol = -1;
	if ('cells' in raw && typeof raw.cells === 'object' && raw.cells !== null) {
		for (const [key, value] of Object.entries(raw.cells)) {
			const pos = parseKey(key);
			// Drop cells outside the hard grid limits so a single extreme
			// coordinate can't blow the rendered grid up to millions of nodes.
			if (!pos || pos.row >= MAX_ROWS || pos.col >= MAX_COLS) {
				continue;
			}
			const cell = normalizeCell(value);
			if (!cell) {
				continue;
			}
			cells[key] = cell;
			if (pos.row > maxRow) {
				maxRow = pos.row;
			}
			if (pos.col > maxCol) {
				maxCol = pos.col;
			}
		}
	}
	// Grid extent: at least the default, always large enough to contain every
	// stored cell (legacy scenes may omit rows/cols), but never beyond the cap.
	const rows = Math.min(
		MAX_ROWS,
		Math.max(clampInt('rows' in raw ? raw.rows : null, 1, MAX_ROWS, DEFAULT_ROWS), maxRow + 1)
	);
	const cols = Math.min(
		MAX_COLS,
		Math.max(clampInt('cols' in raw ? raw.cols : null, 1, MAX_COLS, DEFAULT_COLS), maxCol + 1)
	);
	return {
		id: 'id' in raw && typeof raw.id === 'string' ? raw.id : uid(),
		name: 'name' in raw && typeof raw.name === 'string' && raw.name ? raw.name : 'Sheet1',
		rows,
		cols,
		cells,
		colWidths: normalizeSizeMap(
			'colWidths' in raw ? raw.colWidths : null,
			MIN_COL_WIDTH,
			MAX_COL_WIDTH
		),
		rowHeights: normalizeSizeMap(
			'rowHeights' in raw ? raw.rowHeights : null,
			MIN_ROW_HEIGHT,
			MAX_ROW_HEIGHT
		),
		frozenRows: clampInt('frozenRows' in raw ? raw.frozenRows : null, 0, rows, 0),
		frozenCols: clampInt('frozenCols' in raw ? raw.frozenCols : null, 0, cols, 0)
	};
}

export function normalizeBook(raw: unknown): SheetBook {
	if (typeof raw !== 'object' || raw === null || !('sheets' in raw) || !Array.isArray(raw.sheets)) {
		return createEmptyBook();
	}
	const sheets: Sheet[] = [];
	const seen = new Set<string>();
	for (const s of raw.sheets) {
		const sheet = normalizeSheet(s);
		if (sheet) {
			// Guarantee unique ids even if the stored data had collisions.
			if (seen.has(sheet.id)) {
				sheet.id = uid();
			}
			seen.add(sheet.id);
			sheets.push(sheet);
		}
	}
	if (sheets.length === 0) {
		return createEmptyBook();
	}
	const storedActive =
		'activeSheetId' in raw && typeof raw.activeSheetId === 'string' ? raw.activeSheetId : '';
	const activeSheetId = sheets.some((s) => s.id === storedActive) ? storedActive : sheets[0].id;
	return { version: 1, sheets, activeSheetId };
}

/** Parse a stored scene string into a workbook, tolerating empty/legacy/garbage. */
export function parseBook(scene: string | null): SheetBook {
	if (!scene) {
		return createEmptyBook();
	}
	try {
		return normalizeBook(JSON.parse(scene));
	} catch {
		return createEmptyBook();
	}
}

export function serializeBook(book: SheetBook): string {
	return JSON.stringify(book);
}

// ============================================================
// lookups
// ============================================================

export function getSheet(book: SheetBook, sheetId: string): Sheet | null {
	return book.sheets.find((s) => s.id === sheetId) ?? null;
}

export function activeSheet(book: SheetBook): Sheet {
	return getSheet(book, book.activeSheetId) ?? book.sheets[0];
}

export function getCell(sheet: Sheet, row: number, col: number): Cell | null {
	return sheet.cells[cellKey(row, col)] ?? null;
}

/** Raw input string for a cell, or '' when empty. */
export function getRaw(sheet: Sheet, row: number, col: number): string {
	return sheet.cells[cellKey(row, col)]?.v ?? '';
}

export function colWidth(sheet: Sheet, col: number): number {
	return sheet.colWidths[String(col)] ?? DEFAULT_COL_WIDTH;
}

export function rowHeight(sheet: Sheet, row: number): number {
	return sheet.rowHeights[String(row)] ?? DEFAULT_ROW_HEIGHT;
}

// ============================================================
// mutations (operate in place on the book/sheet)
// ============================================================

/**
 * Set a cell's raw input. Empty input with no formatting deletes the cell so
 * the sparse map stays tight; otherwise the existing formatting is preserved.
 */
export function setCellRaw(sheet: Sheet, row: number, col: number, value: string): void {
	const key = cellKey(row, col);
	const existing = sheet.cells[key];
	if (value === '' && !existing?.f) {
		delete sheet.cells[key];
		return;
	}
	if (existing) {
		existing.v = value;
	} else {
		sheet.cells[key] = { v: value };
	}
	growToFit(sheet, row, col);
}

/** Apply a partial format change to a cell, creating it if needed. */
export function updateCellFormat(
	sheet: Sheet,
	row: number,
	col: number,
	patch: Partial<CellFormat>
): void {
	const key = cellKey(row, col);
	const existing = sheet.cells[key];
	const base: CellFormat = existing?.f ? { ...existing.f } : {};
	const cleaned = cleanFormat({ ...base, ...patch });
	if (existing) {
		if (cleaned) {
			existing.f = cleaned;
		} else {
			delete existing.f;
			if (existing.v === '') {
				delete sheet.cells[key];
			}
		}
	} else if (cleaned) {
		sheet.cells[key] = { v: '', f: cleaned };
	}
	growToFit(sheet, row, col);
}

function cleanFormat(f: CellFormat): CellFormat | null {
	const out: CellFormat = {};
	if (f.bold) {
		out.bold = true;
	}
	if (f.italic) {
		out.italic = true;
	}
	if (f.underline) {
		out.underline = true;
	}
	if (f.strike) {
		out.strike = true;
	}
	if (f.wrap) {
		out.wrap = true;
	}
	if (f.align && f.align !== 'left') {
		out.align = f.align;
	}
	if (f.color) {
		out.color = f.color;
	}
	if (f.bg) {
		out.bg = f.bg;
	}
	if (f.numFmt && f.numFmt !== 'auto') {
		out.numFmt = f.numFmt;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** Clear contents (keep formatting) for every cell in an inclusive range. */
export function clearRangeContents(sheet: Sheet, r1: number, c1: number, r2: number, c2: number) {
	const rowA = Math.min(r1, r2);
	const rowB = Math.max(r1, r2);
	const colA = Math.min(c1, c2);
	const colB = Math.max(c1, c2);
	for (let r = rowA; r <= rowB; r++) {
		for (let c = colA; c <= colB; c++) {
			const key = cellKey(r, c);
			const cell = sheet.cells[key];
			if (!cell) {
				continue;
			}
			if (cell.f) {
				cell.v = '';
			} else {
				delete sheet.cells[key];
			}
		}
	}
}

/** Clear everything (contents + formatting) in an inclusive range. */
export function clearRangeAll(sheet: Sheet, r1: number, c1: number, r2: number, c2: number) {
	const rowA = Math.min(r1, r2);
	const rowB = Math.max(r1, r2);
	const colA = Math.min(c1, c2);
	const colB = Math.max(c1, c2);
	for (let r = rowA; r <= rowB; r++) {
		for (let c = colA; c <= colB; c++) {
			delete sheet.cells[cellKey(r, c)];
		}
	}
}

export function setColWidth(sheet: Sheet, col: number, width: number): void {
	sheet.colWidths[String(col)] = Math.min(
		MAX_COL_WIDTH,
		Math.max(MIN_COL_WIDTH, Math.round(width))
	);
}

export function setRowHeight(sheet: Sheet, row: number, height: number): void {
	sheet.rowHeights[String(row)] = Math.min(
		MAX_ROW_HEIGHT,
		Math.max(MIN_ROW_HEIGHT, Math.round(height))
	);
}

export function addRows(sheet: Sheet, count = 20): void {
	sheet.rows = Math.min(MAX_ROWS, sheet.rows + Math.max(1, count));
}

export function addCols(sheet: Sheet, count = 5): void {
	sheet.cols = Math.min(MAX_COLS, sheet.cols + Math.max(1, count));
}

/** Make sure the grid is at least large enough to address (row, col). */
function growToFit(sheet: Sheet, row: number, col: number): void {
	if (row + 1 > sheet.rows) {
		sheet.rows = Math.min(MAX_ROWS, row + 1);
	}
	if (col + 1 > sheet.cols) {
		sheet.cols = Math.min(MAX_COLS, col + 1);
	}
}

// ----- sheet (tab) operations -----

export function addSheet(book: SheetBook, name?: string): Sheet {
	const existing = new Set(book.sheets.map((s) => s.name));
	let n = book.sheets.length + 1;
	let finalName = name?.trim() || `Sheet${n}`;
	while (existing.has(finalName)) {
		n++;
		finalName = `Sheet${n}`;
	}
	const sheet = newSheet(finalName);
	book.sheets.push(sheet);
	book.activeSheetId = sheet.id;
	return sheet;
}

export function removeSheet(book: SheetBook, sheetId: string): void {
	if (book.sheets.length <= 1) {
		return;
	}
	const idx = book.sheets.findIndex((s) => s.id === sheetId);
	if (idx === -1) {
		return;
	}
	book.sheets.splice(idx, 1);
	if (book.activeSheetId === sheetId) {
		book.activeSheetId = book.sheets[Math.max(0, idx - 1)].id;
	}
}

export function renameSheet(book: SheetBook, sheetId: string, name: string): void {
	const sheet = getSheet(book, sheetId);
	const trimmed = name.trim();
	if (sheet && trimmed) {
		sheet.name = trimmed;
	}
}

export function selectSheet(book: SheetBook, sheetId: string): void {
	if (book.sheets.some((s) => s.id === sheetId)) {
		book.activeSheetId = sheetId;
	}
}
