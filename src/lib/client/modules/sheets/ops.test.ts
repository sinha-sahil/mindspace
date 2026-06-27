import { describe, it, expect } from 'vitest';
import { createEmptyBook, parseA1, setCellRaw, getRaw, type Sheet } from './model';
import { formatValue } from './engine';
import { insertRows, deleteRows, insertCols, deleteCols, fillRange } from './ops';

function sheetWith(cells: Record<string, string>): Sheet {
	const b = createEmptyBook();
	const s = b.sheets[0];
	for (const [a1, v] of Object.entries(cells)) {
		const r = parseA1(a1)!;
		setCellRaw(s, r.row, r.col, v);
	}
	return s;
}
function raw(s: Sheet, a1: string): string {
	const r = parseA1(a1)!;
	return getRaw(s, r.row, r.col);
}

describe('insert / delete rows', () => {
	it('inserts a row, shifting cells + formula refs below', () => {
		const s = sheetWith({ A1: '1', A2: '2', A3: '=A1+A2' });
		insertRows(s, 1, 1);
		expect(raw(s, 'A1')).toBe('1');
		expect(raw(s, 'A2')).toBe('');
		expect(raw(s, 'A3')).toBe('2');
		expect(raw(s, 'A4')).toBe('=A1+A3');
	});
	it('deletes a row, turning refs to deleted cells into #REF!', () => {
		const s = sheetWith({ A1: '1', A2: '2', A3: '3', B1: '=A2' });
		deleteRows(s, 1, 1);
		expect(raw(s, 'A1')).toBe('1');
		expect(raw(s, 'A2')).toBe('3');
		expect(raw(s, 'A3')).toBe('');
		expect(raw(s, 'B1')).toBe('=#REF!');
	});
	it('deletes rows, shifting refs below the deletion up', () => {
		const s = sheetWith({ A5: '5', B1: '=A5' });
		deleteRows(s, 1, 2);
		expect(raw(s, 'A3')).toBe('5');
		expect(raw(s, 'B1')).toBe('=A3');
	});
});

describe('insert / delete columns', () => {
	it('inserts a column, shifting cells + refs right', () => {
		const s = sheetWith({ A1: '1', B1: '2', C1: '=A1+B1' });
		insertCols(s, 1, 1);
		expect(raw(s, 'A1')).toBe('1');
		expect(raw(s, 'C1')).toBe('2');
		expect(raw(s, 'D1')).toBe('=A1+C1');
	});
	it('deletes a column', () => {
		const s = sheetWith({ A1: '1', B1: '2', C1: '3' });
		deleteCols(s, 1, 1);
		expect(raw(s, 'A1')).toBe('1');
		expect(raw(s, 'B1')).toBe('3');
		expect(raw(s, 'C1')).toBe('');
	});
});

describe('merges shift with structural edits', () => {
	it('shifts a merge when inserting a column before it', () => {
		const s = sheetWith({ A1: 'x' });
		s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 1 });
		insertCols(s, 0, 1);
		expect(s.merges[0]).toEqual({ r1: 0, c1: 1, r2: 0, c2: 2 });
	});
	it('drops a merge fully inside deleted rows', () => {
		const s = sheetWith({ A2: 'x' });
		s.merges.push({ r1: 1, c1: 0, r2: 2, c2: 1 });
		deleteRows(s, 1, 2);
		expect(s.merges.length).toBe(0);
	});
});

describe('fill handle / autofill', () => {
	it('extends a numeric series downward', () => {
		const s = sheetWith({ A1: '1', A2: '2' });
		fillRange(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
		expect(raw(s, 'A3')).toBe('3');
		expect(raw(s, 'A4')).toBe('4');
		expect(raw(s, 'A5')).toBe('5');
	});
	it('extends a numeric series with a step of 2', () => {
		const s = sheetWith({ A1: '2', A2: '4' });
		fillRange(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
		expect(raw(s, 'A3')).toBe('6');
		expect(raw(s, 'A4')).toBe('8');
	});
	it('copies a single number (no series)', () => {
		const s = sheetWith({ A1: '7' });
		fillRange(s, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
		expect(raw(s, 'A2')).toBe('7');
		expect(raw(s, 'A3')).toBe('7');
	});
	it('translates formulas when filling down', () => {
		const s = sheetWith({ A1: '10', A2: '20', B1: '=A1*2' });
		fillRange(s, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 1, c1: 1, r2: 1, c2: 1 });
		expect(raw(s, 'B2')).toBe('=A2*2');
	});
	it('continues a month-name series', () => {
		const s = sheetWith({ A1: 'Jan', A2: 'Feb' });
		fillRange(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
		expect(raw(s, 'A3')).toBe('Mar');
		expect(raw(s, 'A4')).toBe('Apr');
	});
	it('increments a text+number pattern from a single cell', () => {
		const s = sheetWith({ A1: 'Item 1' });
		fillRange(s, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
		expect(raw(s, 'A2')).toBe('Item 2');
		expect(raw(s, 'A3')).toBe('Item 3');
	});
	it('fills a series to the right', () => {
		const s = sheetWith({ A1: '1', B1: '2' });
		fillRange(s, { r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 0, c1: 0, r2: 0, c2: 3 });
		expect(raw(s, 'C1')).toBe('3');
		expect(raw(s, 'D1')).toBe('4');
	});
	it('extends a series upward', () => {
		const s = sheetWith({ A3: '2', A4: '3' });
		fillRange(s, { r1: 2, c1: 0, r2: 3, c2: 0 }, { r1: 0, c1: 0, r2: 3, c2: 0 });
		expect(raw(s, 'A2')).toBe('1');
		expect(raw(s, 'A1')).toBe('0');
	});
	it('extends a series to the left', () => {
		const s = sheetWith({ C1: '3', D1: '4' });
		fillRange(s, { r1: 0, c1: 2, r2: 0, c2: 3 }, { r1: 0, c1: 0, r2: 0, c2: 3 });
		expect(raw(s, 'B1')).toBe('2');
		expect(raw(s, 'A1')).toBe('1');
	});
	it('continues a weekday series', () => {
		const s = sheetWith({ A1: 'Mon', A2: 'Tue' });
		fillRange(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
		expect(raw(s, 'A3')).toBe('Wed');
	});
});

describe('merges crossing structural edits', () => {
	it('grows a merge when a row is inserted inside it', () => {
		const s = sheetWith({ A1: 'x' });
		s.merges.push({ r1: 0, c1: 0, r2: 2, c2: 0 }); // A1:A3
		insertRows(s, 1, 1);
		expect(s.merges[0]).toEqual({ r1: 0, c1: 0, r2: 3, c2: 0 }); // A1:A4
	});
	it('shrinks a merge when a spanned row is deleted', () => {
		const s = sheetWith({ A1: 'x' });
		s.merges.push({ r1: 0, c1: 0, r2: 2, c2: 0 }); // A1:A3
		deleteRows(s, 1, 1);
		expect(s.merges[0]).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 }); // A1:A2
	});
	it('shifts a merge below an inserted row', () => {
		const s = sheetWith({ B2: 'x' });
		s.merges.push({ r1: 1, c1: 1, r2: 1, c2: 2 }); // B2:C2
		insertRows(s, 0, 1);
		expect(s.merges[0]).toEqual({ r1: 2, c1: 1, r2: 2, c2: 2 }); // B3:C3
	});
});

describe('range refs contract on delete (not #REF!)', () => {
	it('contracts a range when a boundary row is deleted', () => {
		const s = sheetWith({ B1: '=SUM(A2:A5)' });
		deleteRows(s, 1, 1); // delete A2 (the range top)
		expect(raw(s, 'B1')).toBe('=SUM(A2:A4)');
	});
	it('contracts a range when the bottom row is deleted', () => {
		const s = sheetWith({ B1: '=SUM(A2:A5)' });
		deleteRows(s, 4, 1); // delete A5 (the range bottom)
		expect(raw(s, 'B1')).toBe('=SUM(A2:A4)');
	});
	it('only emits #REF! when the whole range is deleted', () => {
		const s = sheetWith({ B1: '=SUM(A2:A3)' });
		deleteRows(s, 1, 2);
		expect(raw(s, 'B1')).toBe('=SUM(#REF!:#REF!)');
	});
});

describe('frozen panes vs insert', () => {
	it('inserting at the top does not create a phantom frozen row/col', () => {
		const s = sheetWith({});
		expect(s.frozenRows).toBe(0);
		insertRows(s, 0, 1);
		expect(s.frozenRows).toBe(0);
		insertCols(s, 0, 1);
		expect(s.frozenCols).toBe(0);
	});
	it('insert inside the frozen region grows it; at the boundary it does not', () => {
		const a = sheetWith({});
		a.frozenRows = 2;
		insertRows(a, 1, 1);
		expect(a.frozenRows).toBe(3);
		const b = sheetWith({});
		b.frozenRows = 2;
		insertRows(b, 2, 1);
		expect(b.frozenRows).toBe(2);
	});
});

describe('number-format extensions', () => {
	it('honours the decimals override', () => {
		expect(formatValue(1234.567, 'number', 1)).toBe('1,234.6');
		expect(formatValue(0.5, 'percent', 0)).toBe('50%');
		expect(formatValue(3.14159, null, 2)).toBe('3.14');
	});
	it('formats accounting with parenthesised negatives', () => {
		expect(formatValue(5, 'accounting')).toBe('$5.00');
		expect(formatValue(-5, 'accounting')).toBe('($5.00)');
	});
	it('formats durations as h:mm:ss', () => {
		expect(formatValue(0.5, 'duration')).toBe('12:00:00');
		expect(formatValue(1.5, 'duration')).toBe('36:00:00');
	});
});
