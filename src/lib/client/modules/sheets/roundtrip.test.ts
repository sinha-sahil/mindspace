import { describe, it, expect } from 'vitest';
import {
	normalizeBook,
	serializeBook,
	parseA1,
	setCellRaw,
	addSheet,
	getSheet,
	MAX_ROWS,
	MAX_COLS
} from './model';
import { Engine } from './engine';

// Simulates the MCP set_sheet_cells → store → get_sheet round trip end-to-end.
describe('MCP round-trip', () => {
	it('writes A1 cells + formulas, persists through scene, reads computed values', () => {
		// fresh book (as the server would build via normalizeBook(null-ish))
		let book = normalizeBook({ sheets: [] }); // garbage-ish → self-heals to one sheet
		expect(book.sheets.length).toBe(1);

		const target = getSheet(book, book.activeSheetId)!;
		const writes: Array<[string, string]> = [
			['A1', '10'],
			['A2', '20'],
			['A3', '=SUM(A1:A2)'],
			['B1', 'price'],
			['B2', '=A3*1.1']
		];
		for (const [a1, v] of writes) {
			const ref = parseA1(a1)!;
			setCellRaw(target, ref.row, ref.col, v);
		}

		// persist exactly as the endpoint does
		const stored = JSON.parse(serializeBook(book));
		// reload exactly as the endpoint does on the next request
		book = normalizeBook(stored);
		const engine = new Engine(book);
		const sheet = getSheet(book, book.activeSheetId)!;

		const at = (a1: string) => {
			const r = parseA1(a1)!;
			return engine.getValue(sheet.id, r.row, r.col);
		};
		expect(at('A3')).toBe(30);
		expect(at('B2')).toBe(33);
		expect(engine.display(sheet.id, parseA1('B2')!.row, parseA1('B2')!.col)).toBe('33');
	});

	it('cross-sheet refs survive add + persist', () => {
		let book = normalizeBook({ sheets: [] });
		const s1 = getSheet(book, book.activeSheetId)!;
		setCellRaw(s1, 0, 0, '=Data!A1+5');
		const s2 = addSheet(book, 'Data');
		setCellRaw(s2, 0, 0, '100');
		book = normalizeBook(JSON.parse(serializeBook(book)));
		const eng = new Engine(book);
		const first = book.sheets[0];
		expect(eng.getValue(first.id, 0, 0)).toBe(105);
	});

	it('a cell referencing a cycle does not poison an independent cell', () => {
		const book = normalizeBook({
			sheets: [
				{ name: 'S', cells: { '0:0': { v: '=B1' }, '0:1': { v: '=A1' }, '0:2': { v: '=5+5' } } }
			]
		});
		const eng = new Engine(book);
		const id = book.sheets[0].id;
		// A1/B1 are a cycle
		expect(eng.getValue(id, 0, 0)).toBeTruthy();
		// C1 is independent and must still compute correctly
		expect(eng.getValue(id, 0, 2)).toBe(10);
	});

	it('clamps out-of-range cells + grid extent to the hard caps (no render blow-up)', () => {
		const book = normalizeBook({
			sheets: [{ name: 'S', cells: { '99999:0': { v: 'x' }, '0:0': { v: 'ok' } } }]
		});
		const s = book.sheets[0];
		expect(s.rows).toBeLessThanOrEqual(MAX_ROWS);
		expect(s.cols).toBeLessThanOrEqual(MAX_COLS);
		// the extreme cell is dropped; the in-range cell survives
		expect(s.cells['99999:0']).toBeUndefined();
		expect(s.cells['0:0']).toBeDefined();
	});
});
