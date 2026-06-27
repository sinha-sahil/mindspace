/**
 * Higher-level spreadsheet operations that need BOTH the data model and the
 * formula engine: inserting/deleting rows & columns (which must rewrite the
 * references inside formulas) and the fill handle / autofill series.
 *
 * Kept separate so model.ts stays engine-free and engine.ts stays
 * mutation-free; this orchestration layer is the only place that depends on
 * both. Everything here is pure (no DOM) and operates in place on a Sheet.
 */

import {
	type Sheet,
	type Cell,
	type CellFormat,
	type MergeRange,
	cellKey,
	parseKey,
	getRaw,
	getCell,
	setCellRaw,
	MAX_ROWS,
	MAX_COLS
} from './model';
import { remapSameSheetRefs, translateFormula, parseLiteral } from './engine';

// ============================================================
// generic remapping helpers
// ============================================================

type IndexMap = (i: number) => number | null;

/** Rewrite same-sheet refs in every formula cell through row/col maps. */
function remapFormulas(sheet: Sheet, rowMap: IndexMap, colMap: IndexMap): void {
	for (const cell of Object.values(sheet.cells)) {
		if (cell.v.startsWith('=')) {
			cell.v = remapSameSheetRefs(cell.v, rowMap, colMap);
		}
	}
}

/** Rebuild the sparse cell map by moving each cell through (rowMap,colMap). */
function moveCells(sheet: Sheet, rowMap: IndexMap, colMap: IndexMap): void {
	const next: Record<string, Cell> = {};
	for (const [key, cell] of Object.entries(sheet.cells)) {
		const pos = parseKey(key);
		if (!pos) {
			continue;
		}
		const nr = rowMap(pos.row);
		const nc = colMap(pos.col);
		if (nr === null || nc === null || nr < 0 || nc < 0 || nr >= MAX_ROWS || nc >= MAX_COLS) {
			continue; // cell was deleted
		}
		next[cellKey(nr, nc)] = cell;
	}
	sheet.cells = next;
}

/** Rebuild a numeric index→size map through an index map (null drops). */
function moveSizeMap(map: Record<string, number>, idxMap: IndexMap): Record<string, number> {
	const next: Record<string, number> = {};
	for (const [k, v] of Object.entries(map)) {
		if (!/^\d+$/.test(k)) {
			continue;
		}
		const ni = idxMap(Number(k));
		if (ni !== null && ni >= 0) {
			next[String(ni)] = v;
		}
	}
	return next;
}

/** Remap merges through row/col maps; drop empties and 1x1 degenerates. */
function remapMerges(sheet: Sheet, rowMap: IndexMap, colMap: IndexMap): void {
	const next: MergeRange[] = [];
	for (const m of sheet.merges) {
		const rs: number[] = [];
		for (let r = m.r1; r <= m.r2; r++) {
			const nr = rowMap(r);
			if (nr !== null && nr >= 0) {
				rs.push(nr);
			}
		}
		const cs: number[] = [];
		for (let c = m.c1; c <= m.c2; c++) {
			const nc = colMap(c);
			if (nc !== null && nc >= 0) {
				cs.push(nc);
			}
		}
		if (rs.length === 0 || cs.length === 0) {
			continue;
		}
		const block = {
			r1: Math.min(...rs),
			r2: Math.max(...rs),
			c1: Math.min(...cs),
			c2: Math.max(...cs)
		};
		if (block.r1 === block.r2 && block.c1 === block.c2) {
			continue;
		}
		next.push(block);
	}
	sheet.merges = next;
}

const identity: IndexMap = (i) => i;

// ============================================================
// insert / delete rows & columns
// ============================================================

export function insertRows(sheet: Sheet, at: number, count = 1): void {
	const n = Math.max(1, count);
	const rowMap: IndexMap = (r) => (r >= at ? r + n : r);
	remapFormulas(sheet, rowMap, identity);
	moveCells(sheet, rowMap, identity);
	sheet.rowHeights = moveSizeMap(sheet.rowHeights, rowMap);
	remapMerges(sheet, rowMap, identity);
	if (at < sheet.frozenRows) {
		sheet.frozenRows += n;
	}
	sheet.rows = Math.min(MAX_ROWS, sheet.rows + n);
}

export function deleteRows(sheet: Sheet, at: number, count = 1): void {
	const n = Math.min(Math.max(1, count), sheet.rows - 1, sheet.rows - at);
	if (n <= 0) {
		return;
	}
	const rowMap: IndexMap = (r) => {
		if (r < at) {
			return r;
		}
		if (r < at + n) {
			return null;
		}
		return r - n;
	};
	remapFormulas(sheet, rowMap, identity);
	moveCells(sheet, rowMap, identity);
	sheet.rowHeights = moveSizeMap(sheet.rowHeights, rowMap);
	remapMerges(sheet, rowMap, identity);
	if (at < sheet.frozenRows) {
		sheet.frozenRows = Math.max(0, sheet.frozenRows - Math.min(n, sheet.frozenRows - at));
	}
	sheet.rows = Math.max(1, sheet.rows - n);
}

export function insertCols(sheet: Sheet, at: number, count = 1): void {
	const n = Math.max(1, count);
	const colMap: IndexMap = (c) => (c >= at ? c + n : c);
	remapFormulas(sheet, identity, colMap);
	moveCells(sheet, identity, colMap);
	sheet.colWidths = moveSizeMap(sheet.colWidths, colMap);
	remapMerges(sheet, identity, colMap);
	if (at < sheet.frozenCols) {
		sheet.frozenCols += n;
	}
	sheet.cols = Math.min(MAX_COLS, sheet.cols + n);
}

export function deleteCols(sheet: Sheet, at: number, count = 1): void {
	const n = Math.min(Math.max(1, count), sheet.cols - 1, sheet.cols - at);
	if (n <= 0) {
		return;
	}
	const colMap: IndexMap = (c) => {
		if (c < at) {
			return c;
		}
		if (c < at + n) {
			return null;
		}
		return c - n;
	};
	remapFormulas(sheet, identity, colMap);
	moveCells(sheet, identity, colMap);
	sheet.colWidths = moveSizeMap(sheet.colWidths, colMap);
	remapMerges(sheet, identity, colMap);
	if (at < sheet.frozenCols) {
		sheet.frozenCols = Math.max(0, sheet.frozenCols - Math.min(n, sheet.frozenCols - at));
	}
	sheet.cols = Math.max(1, sheet.cols - n);
}

// ============================================================
// fill handle / autofill
// ============================================================

const MONTHS_FULL = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];
const MONTHS_ABBR = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function asNum(raw: string): number | null {
	const v = parseLiteral(raw);
	return typeof v === 'number' ? v : null;
}

function cleanNum(x: number): string {
	if (Number.isInteger(x)) {
		return String(x);
	}
	return String(parseFloat(x.toPrecision(12)));
}

function nameIndex(value: string, full: string[], abbr: string[]): number {
	const v = value.trim().toLowerCase();
	const fi = full.findIndex((m) => m.toLowerCase() === v);
	if (fi >= 0) {
		return fi;
	}
	return abbr.findIndex((m) => m.toLowerCase() === v);
}

function nameSeries(
	vals: string[],
	full: string[],
	abbr: string[]
): ((n: number) => string) | null {
	const idx = vals.map((v) => nameIndex(v, full, abbr));
	if (idx.some((i) => i < 0)) {
		return null;
	}
	const len = full.length;
	const useAbbr = vals[0].trim().length <= 3;
	const upper = vals[0] === vals[0].toUpperCase();
	const names = useAbbr ? abbr : full;
	let step = 1;
	if (idx.length >= 2) {
		const raw = (((idx[1] - idx[0]) % len) + len) % len;
		step = raw === 0 ? len : raw;
		if (step > len / 2) {
			step -= len; // prefer the shorter signed direction (e.g. Dec→Nov = -1)
		}
	}
	const last = idx[idx.length - 1];
	return (k: number) => {
		const name = names[(((last + k * step) % len) + len) % len];
		return upper ? name.toUpperCase() : name;
	};
}

/**
 * Build a generator for the cells BEYOND a source line. `vals` are the source
 * raw strings in fill order. Returns fn(k) for the k-th new cell (k=1,2,…), or
 * null when there is no detectable series (caller falls back to copying).
 */
function buildSeries(vals: string[]): ((n: number) => string) | null {
	if (vals.length === 0 || vals.every((v) => v.trim() === '')) {
		return null;
	}
	// pure numbers
	const nums = vals.map(asNum);
	if (nums.every((x) => x !== null)) {
		const ns: number[] = [];
		for (const x of nums) {
			if (x !== null) {
				ns.push(x);
			}
		}
		if (ns.length === 1) {
			return null; // single number → copy (Sheets behaviour)
		}
		const step = (ns[ns.length - 1] - ns[0]) / (ns.length - 1);
		const last = ns[ns.length - 1];
		return (k) => cleanNum(last + k * step);
	}
	// month / weekday names
	const monthFn = nameSeries(vals, MONTHS_FULL, MONTHS_ABBR);
	if (monthFn) {
		return monthFn;
	}
	const dayFn = nameSeries(vals, DAYS_FULL, DAYS_ABBR);
	if (dayFn) {
		return dayFn;
	}
	// text with a trailing number and a shared prefix ("Item 1", "Q3")
	const parts = vals.map((v) => /^(.*?)(-?\d+)$/.exec(v.trim()));
	if (parts.every((p) => p !== null)) {
		const prefix = parts[0]?.[1] ?? '';
		if (parts.every((p) => p?.[1] === prefix)) {
			const tn = parts.map((p) => Number(p?.[2]));
			if (tn.length === 1) {
				return (k) => prefix + (tn[0] + k); // single "Item 1" → increments
			}
			const step = (tn[tn.length - 1] - tn[0]) / (tn.length - 1);
			const last = tn[tn.length - 1];
			return (k) => prefix + Math.round(last + k * step);
		}
	}
	return null;
}

function cloneFormat(f: CellFormat | null): CellFormat | null {
	return f ? JSON.parse(JSON.stringify(f)) : null;
}

/** Copy a source cell's formatting onto a destination cell (which must exist). */
function applyFormat(sheet: Sheet, dr: number, dc: number, f: CellFormat | null): void {
	const cell = sheet.cells[cellKey(dr, dc)];
	if (!cell) {
		return;
	}
	if (f) {
		cell.f = f;
	} else {
		delete cell.f;
	}
}

export type FillRange = { r1: number; c1: number; r2: number; c2: number };

/**
 * Extend the source range into the destination via the fill handle. `dest`
 * contains `src` and extends it in exactly one direction. Formulas are
 * translated relative to their source cell; literals continue a detected series
 * or copy the source pattern cyclically. Source formatting is carried along.
 */
export function fillRange(sheet: Sheet, src: FillRange, dest: FillRange): void {
	const down = dest.r2 > src.r2;
	const up = dest.r1 < src.r1;
	const right = dest.c2 > src.c2;
	const left = dest.c1 < src.c1;

	if (down || up) {
		const srcH = src.r2 - src.r1 + 1;
		for (let c = src.c1; c <= src.c2; c++) {
			const colVals: string[] = [];
			for (let r = src.r1; r <= src.r2; r++) {
				colVals.push(getRaw(sheet, r, c));
			}
			if (down) {
				const series = buildSeries(colVals);
				for (let r = src.r2 + 1; r <= dest.r2; r++) {
					const k = r - src.r2; // 1,2,…
					const srcRow = src.r1 + ((((r - src.r1) % srcH) + srcH) % srcH);
					fillOne(sheet, srcRow, c, r, c, series, k);
				}
			}
			if (up) {
				const series = buildSeries([...colVals].reverse());
				for (let r = src.r1 - 1; r >= dest.r1; r--) {
					const k = src.r1 - r;
					const srcRow = src.r2 - ((((src.r2 - r) % srcH) + srcH) % srcH);
					fillOne(sheet, srcRow, c, r, c, series, k);
				}
			}
		}
		return;
	}

	if (right || left) {
		const srcW = src.c2 - src.c1 + 1;
		for (let r = src.r1; r <= src.r2; r++) {
			const rowVals: string[] = [];
			for (let c = src.c1; c <= src.c2; c++) {
				rowVals.push(getRaw(sheet, r, c));
			}
			if (right) {
				const series = buildSeries(rowVals);
				for (let c = src.c2 + 1; c <= dest.c2; c++) {
					const k = c - src.c2;
					const srcCol = src.c1 + ((((c - src.c1) % srcW) + srcW) % srcW);
					fillOne(sheet, r, srcCol, r, c, series, k);
				}
			}
			if (left) {
				const series = buildSeries([...rowVals].reverse());
				for (let c = src.c1 - 1; c >= dest.c1; c--) {
					const k = src.c1 - c;
					const srcCol = src.c2 - ((((src.c2 - c) % srcW) + srcW) % srcW);
					fillOne(sheet, r, srcCol, r, c, series, k);
				}
			}
		}
	}
}

function fillOne(
	sheet: Sheet,
	srcRow: number,
	srcCol: number,
	dr: number,
	dc: number,
	series: ((n: number) => string) | null,
	k: number
): void {
	const srcRaw = getRaw(sheet, srcRow, srcCol);
	let value: string;
	if (srcRaw.startsWith('=')) {
		value = translateFormula(srcRaw, dr - srcRow, dc - srcCol);
	} else if (series) {
		value = series(k);
	} else {
		value = srcRaw;
	}
	const fmt = cloneFormat(getCell(sheet, srcRow, srcCol)?.f ?? null);
	setCellRaw(sheet, dr, dc, value);
	applyFormat(sheet, dr, dc, fmt);
}
