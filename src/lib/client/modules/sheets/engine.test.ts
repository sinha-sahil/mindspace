import { describe, it, expect } from 'vitest';
import {
	Engine,
	FormulaError,
	parseLiteral,
	parseNumberLiteral,
	translateFormula,
	formatValue,
	type CellValue
} from './engine';
import {
	createEmptyBook,
	newSheet,
	colToLetter,
	letterToCol,
	parseA1,
	toA1,
	setCellRaw,
	type SheetBook,
	type Sheet
} from './model';

/** Build a single-sheet book from an A1 → raw-input map and return [book, sheet]. */
function book(cells: Record<string, string>): { book: SheetBook; sheet: Sheet } {
	const b = createEmptyBook();
	const sheet = b.sheets[0];
	for (const [a1, value] of Object.entries(cells)) {
		const ref = parseA1(a1);
		if (!ref) {
			throw new Error(`bad ref ${a1}`);
		}
		setCellRaw(sheet, ref.row, ref.col, value);
	}
	return { book: b, sheet };
}

/** Evaluate a formula placed in a scratch cell against the given cell map. */
function evalFormula(formula: string, cells: Record<string, string> = {}): CellValue {
	const { book: b, sheet } = book({ ...cells, Z99: formula });
	const engine = new Engine(b);
	const ref = parseA1('Z99')!;
	return engine.getValue(sheet.id, ref.row, ref.col);
}

/** The error code of a value, or a marker string when it isn't an error. */
function errCode(v: CellValue): string {
	return v instanceof FormulaError ? v.code : `not-an-error(${String(v)})`;
}

describe('A1 helpers', () => {
	it('converts columns to letters', () => {
		expect(colToLetter(0)).toBe('A');
		expect(colToLetter(25)).toBe('Z');
		expect(colToLetter(26)).toBe('AA');
		expect(colToLetter(27)).toBe('AB');
		expect(colToLetter(701)).toBe('ZZ');
	});
	it('converts letters to columns', () => {
		expect(letterToCol('A')).toBe(0);
		expect(letterToCol('Z')).toBe(25);
		expect(letterToCol('AA')).toBe(26);
		expect(letterToCol('aa')).toBe(26);
	});
	it('round-trips A1', () => {
		expect(toA1(0, 0)).toBe('A1');
		expect(toA1(2, 1)).toBe('B3');
		expect(parseA1('$B$3')).toEqual({ row: 2, col: 1, absRow: true, absCol: true });
		expect(parseA1('AA10')).toEqual({ row: 9, col: 26, absRow: false, absCol: false });
		expect(parseA1('nonsense')).toBeNull();
	});
});

describe('literal parsing', () => {
	it('parses numbers, booleans, and text', () => {
		expect(parseLiteral('42')).toBe(42);
		expect(parseLiteral('3.14')).toBe(3.14);
		expect(parseLiteral('-5')).toBe(-5);
		expect(parseLiteral('1e3')).toBe(1000);
		expect(parseLiteral('TRUE')).toBe(true);
		expect(parseLiteral('false')).toBe(false);
		expect(parseLiteral('hello')).toBe('hello');
		expect(parseLiteral('')).toBe('');
	});
	it('parses currency, commas, percent, parentheses', () => {
		expect(parseNumberLiteral('$1,234.50')).toBe(1234.5);
		expect(parseNumberLiteral('50%')).toBeCloseTo(0.5);
		expect(parseNumberLiteral('(100)')).toBe(-100);
		expect(parseNumberLiteral('1,000,000')).toBe(1000000);
		expect(parseNumberLiteral('1-2')).toBeNull();
		expect(parseNumberLiteral('12a')).toBeNull();
	});
});

describe('arithmetic + precedence', () => {
	it('evaluates basic arithmetic', () => {
		expect(evalFormula('=1+2*3')).toBe(7);
		expect(evalFormula('=(1+2)*3')).toBe(9);
		expect(evalFormula('=10/4')).toBe(2.5);
		expect(evalFormula('=2+3-1')).toBe(4);
	});
	it('follows Google Sheets exponent/unary precedence (-2^2 = -4)', () => {
		expect(evalFormula('=-2^2')).toBe(-4);
		expect(evalFormula('=2^3^2')).toBe(512); // right-assoc: 2^(3^2)
		expect(evalFormula('=2^-2')).toBe(0.25);
	});
	it('handles percent postfix and unary chains', () => {
		expect(evalFormula('=50%')).toBeCloseTo(0.5);
		expect(evalFormula('=--5')).toBe(5);
		expect(evalFormula('=10*5%')).toBeCloseTo(0.5);
	});
	it('concatenates and compares', () => {
		expect(evalFormula('="a"&"b"&"c"')).toBe('abc');
		expect(evalFormula('=1&2')).toBe('12');
		expect(evalFormula('=2>1')).toBe(true);
		expect(evalFormula('=2<>2')).toBe(false);
		expect(evalFormula('="a"="A"')).toBe(true); // case-insensitive
	});
});

describe('references + ranges', () => {
	it('resolves cell references', () => {
		expect(evalFormula('=A1+B1', { A1: '10', B1: '5' })).toBe(15);
		// A blank reference is a blank sentinel: it displays empty but coerces to
		// 0 in arithmetic and "" in text (matching Sheets where it matters).
		expect(evalFormula('=A1', {})).toBe('');
		expect(evalFormula('=A1+0', {})).toBe(0);
		expect(evalFormula('=A1&"x"', {})).toBe('x');
	});
	it('sums ranges', () => {
		expect(evalFormula('=SUM(A1:A3)', { A1: '1', A2: '2', A3: '3' })).toBe(6);
		expect(evalFormula('=SUM(A1:B2)', { A1: '1', B1: '2', A2: '3', B2: '4' })).toBe(10);
	});
	it('ignores text in numeric aggregation but counts it in COUNTA', () => {
		expect(evalFormula('=SUM(A1:A3)', { A1: '1', A2: 'x', A3: '3' })).toBe(4);
		expect(evalFormula('=COUNT(A1:A3)', { A1: '1', A2: 'x', A3: '3' })).toBe(2);
		expect(evalFormula('=COUNTA(A1:A3)', { A1: '1', A2: 'x', A3: '3' })).toBe(3);
	});
});

describe('functions', () => {
	it('math + stats', () => {
		expect(evalFormula('=AVERAGE(2,4,6)')).toBe(4);
		expect(evalFormula('=MIN(3,1,2)')).toBe(1);
		expect(evalFormula('=MAX(3,1,2)')).toBe(3);
		expect(evalFormula('=ROUND(3.14159,2)')).toBe(3.14);
		expect(evalFormula('=ROUND(2.5,0)')).toBe(3);
		expect(evalFormula('=MOD(7,3)')).toBe(1);
		expect(evalFormula('=POWER(2,10)')).toBe(1024);
		expect(evalFormula('=ABS(-9)')).toBe(9);
		expect(evalFormula('=MEDIAN(1,2,3,4)')).toBe(2.5);
		expect(evalFormula('=SUMPRODUCT(A1:A2,B1:B2)', { A1: '2', A2: '3', B1: '4', B2: '5' })).toBe(
			23
		);
	});
	it('logical', () => {
		expect(evalFormula('=IF(1>0,"yes","no")')).toBe('yes');
		expect(evalFormula('=IF(1<0,"yes","no")')).toBe('no');
		expect(evalFormula('=AND(TRUE,1,2)')).toBe(true);
		expect(evalFormula('=AND(TRUE,FALSE)')).toBe(false);
		expect(evalFormula('=OR(FALSE,0,1)')).toBe(true);
		expect(evalFormula('=NOT(FALSE)')).toBe(true);
		expect(evalFormula('=IFS(FALSE,1,TRUE,2)')).toBe(2);
	});
	it('text', () => {
		expect(evalFormula('=LEN("hello")')).toBe(5);
		expect(evalFormula('=LEFT("hello",2)')).toBe('he');
		expect(evalFormula('=RIGHT("hello",2)')).toBe('lo');
		expect(evalFormula('=MID("hello",2,3)')).toBe('ell');
		expect(evalFormula('=UPPER("abc")')).toBe('ABC');
		expect(evalFormula('=TRIM("  a  b  ")')).toBe('a b');
		expect(evalFormula('=CONCATENATE("a","b","c")')).toBe('abc');
		expect(evalFormula('=SUBSTITUTE("a-b-c","-","_")')).toBe('a_b_c');
		expect(evalFormula('=TEXTJOIN("-",TRUE,"a","","b")')).toBe('a-b');
		expect(evalFormula('=PROPER("hello world")')).toBe('Hello World');
		expect(evalFormula('=FIND("b","abc")')).toBe(2);
	});
	it('lookup', () => {
		const cells = { A1: 'apple', B1: '3', A2: 'pear', B2: '5', A3: 'plum', B3: '7' };
		expect(evalFormula('=VLOOKUP("pear",A1:B3,2,FALSE)', cells)).toBe(5);
		expect(evalFormula('=VLOOKUP("plum",A1:B3,2,FALSE)', cells)).toBe(7);
		expect(evalFormula('=MATCH("pear",A1:A3,0)', cells)).toBe(2);
		expect(evalFormula('=INDEX(A1:B3,3,1)', cells)).toBe('plum');
		expect(evalFormula('=INDEX(B1:B3,MATCH("pear",A1:A3,0),1)', cells)).toBe(5);
	});
	it('conditional aggregation', () => {
		const cells = { A1: '5', A2: '15', A3: '25', B1: '1', B2: '2', B3: '3' };
		expect(evalFormula('=COUNTIF(A1:A3,">10")', cells)).toBe(2);
		expect(evalFormula('=SUMIF(A1:A3,">10")', cells)).toBe(40);
		expect(evalFormula('=SUMIF(A1:A3,">10",B1:B3)', cells)).toBe(5);
		expect(evalFormula('=AVERAGEIF(A1:A3,">10")', cells)).toBe(20);
	});
	it('information', () => {
		expect(evalFormula('=ISBLANK(A1)', {})).toBe(true);
		expect(evalFormula('=ISBLANK(A1)', { A1: '1' })).toBe(false);
		expect(evalFormula('=ISNUMBER(A1)', { A1: '42' })).toBe(true);
		expect(evalFormula('=ISTEXT(A1)', { A1: 'hi' })).toBe(true);
	});
	it('dates', () => {
		expect(evalFormula('=YEAR(DATE(2026,6,26))')).toBe(2026);
		expect(evalFormula('=MONTH(DATE(2026,6,26))')).toBe(6);
		expect(evalFormula('=DAY(DATE(2026,6,26))')).toBe(26);
		// serial difference between two dates
		expect(evalFormula('=DATE(2026,1,2)-DATE(2026,1,1)')).toBe(1);
	});
});

describe('errors', () => {
	it('division by zero', () => {
		const v = evalFormula('=1/0');
		expect(v).toBeInstanceOf(FormulaError);
		expect(errCode(v)).toBe('#DIV/0!');
	});
	it('unknown function', () => {
		expect(errCode(evalFormula('=BOGUS(1)'))).toBe('#NAME?');
	});
	it('propagates errors through operators', () => {
		expect(errCode(evalFormula('=1/0+5'))).toBe('#DIV/0!');
	});
	it('traps errors with IFERROR', () => {
		expect(evalFormula('=IFERROR(1/0,"oops")')).toBe('oops');
		expect(evalFormula('=IFERROR(10,"oops")')).toBe(10);
		expect(evalFormula('=ISERROR(1/0)')).toBe(true);
	});
	it('#VALUE! when text used as number', () => {
		expect(errCode(evalFormula('=A1+1', { A1: 'abc' }))).toBe('#VALUE!');
	});
	it('detects reference cycles', () => {
		const { book: b, sheet } = book({ A1: '=B1', B1: '=A1' });
		const engine = new Engine(b);
		const ref = parseA1('A1')!;
		const v = engine.getValue(sheet.id, ref.row, ref.col);
		expect(v).toBeInstanceOf(FormulaError);
		expect(errCode(v)).toBe('#CYCLE!');
	});
	it('flags a self-referential cell', () => {
		const { book: b, sheet } = book({ A1: '=A1+1' });
		const engine = new Engine(b);
		const ref = parseA1('A1')!;
		expect(errCode(engine.getValue(sheet.id, ref.row, ref.col))).toBe('#CYCLE!');
	});
});

describe('cross-sheet references', () => {
	it('resolves Sheet2!A1', () => {
		const b = createEmptyBook();
		const s1 = b.sheets[0];
		const s2 = newSheet('Sheet2');
		b.sheets.push(s2);
		setCellRaw(s2, 0, 0, '99');
		setCellRaw(s1, 0, 0, '=Sheet2!A1+1');
		const engine = new Engine(b);
		expect(engine.getValue(s1.id, 0, 0)).toBe(100);
	});
});

describe('translateFormula', () => {
	it('shifts relative refs, keeps absolute', () => {
		expect(translateFormula('=A1', 1, 0)).toBe('=A2');
		expect(translateFormula('=A1', 0, 1)).toBe('=B1');
		expect(translateFormula('=$A$1', 1, 1)).toBe('=$A$1');
		expect(translateFormula('=$A1+B$2', 2, 3)).toBe('=$A3+E$2');
		expect(translateFormula('=SUM(A1:A3)', 1, 0)).toBe('=SUM(A2:A4)');
	});
	it('does not touch function names or strings', () => {
		expect(translateFormula('=SUM(A1)', 1, 0)).toBe('=SUM(A2)');
		expect(translateFormula('="A1"', 1, 0)).toBe('="A1"');
	});
	it('produces #REF! when shifted off the grid', () => {
		expect(translateFormula('=A1', -1, 0)).toBe('=#REF!');
	});
});

describe('formatValue', () => {
	it('formats numbers per number format', () => {
		expect(formatValue(1234.5, 'number')).toBe('1,234.50');
		expect(formatValue(1234.5, 'currency')).toBe('$1,234.50');
		expect(formatValue(0.5, 'percent')).toBe('50%');
		expect(formatValue(3, 'integer')).toBe('3');
		expect(formatValue(1000000, 'integer')).toBe('1,000,000');
	});
	it('passes through text + booleans + errors', () => {
		expect(formatValue('hi', null)).toBe('hi');
		expect(formatValue(true, null)).toBe('TRUE');
		expect(formatValue(new FormulaError('#N/A'), null)).toBe('#N/A');
	});
	it('renders default numbers cleanly', () => {
		expect(formatValue(0.1 + 0.2, null)).toBe('0.3');
		expect(formatValue(42, null)).toBe('42');
	});
});

describe('engine display', () => {
	it('returns formatted display strings', () => {
		const { book: b, sheet } = book({ A1: '5', A2: '=A1*2' });
		const engine = new Engine(b);
		expect(engine.display(sheet.id, 1, 0)).toBe('10');
	});
	it('shows blank cells as empty', () => {
		const { book: b, sheet } = book({});
		const engine = new Engine(b);
		expect(engine.display(sheet.id, 0, 0)).toBe('');
	});
});

// ----- regressions for adversarial-review findings -----

describe('time / date number formats (serial fraction preserved)', () => {
	it('renders the time-of-day fraction instead of collapsing to midnight', () => {
		expect(formatValue(0.25, 'time')).toBe('06:00:00');
		expect(formatValue(0.5, 'time')).toBe('12:00:00');
		expect(formatValue(0.75, 'time')).toBe('18:00:00');
	});
	it('keeps the time component in datetime and does not round the day up', () => {
		const serial = evalFormula('=DATE(2026, 6, 26)');
		expect(typeof serial).toBe('number');
		const s = typeof serial === 'number' ? serial : NaN;
		expect(formatValue(s, 'date')).toBe('Jun 26, 2026');
		// an afternoon fraction must stay on the same day, not round to the 27th
		expect(formatValue(s + 0.9, 'date')).toBe('Jun 26, 2026');
		expect(formatValue(s + 0.5, 'datetime')).toBe('Jun 26, 2026 12:00');
	});
});

describe('blank vs number comparison coerces blank to 0', () => {
	it('treats an empty cell as 0 in comparisons', () => {
		expect(evalFormula('=A1=0', {})).toBe(true);
		expect(evalFormula('=A1>0', {})).toBe(false);
		expect(evalFormula('=A1<0', {})).toBe(false);
		expect(evalFormula('=A1>=0', {})).toBe(true);
		expect(evalFormula('=A1<=0', {})).toBe(true);
	});
});

describe('TRUNC honours the optional digits argument', () => {
	it('truncates to the given number of places', () => {
		expect(evalFormula('=TRUNC(8.789)')).toBe(8);
		expect(evalFormula('=TRUNC(8.789,2)')).toBe(8.78);
		expect(evalFormula('=TRUNC(1234.5,-2)')).toBe(1200);
		expect(evalFormula('=TRUNC(-8.789,2)')).toBe(-8.78);
	});
});

describe('translateFormula shifts cross-sheet references', () => {
	it('shifts the ref after a sheet qualifier', () => {
		expect(translateFormula('=Sheet2!A1', 1, 0)).toBe('=Sheet2!A2');
		expect(translateFormula('=Sheet2!A1+B1', 1, 0)).toBe('=Sheet2!A2+B2');
		expect(translateFormula("='My Sheet'!A1", 1, 0)).toBe("='My Sheet'!A2");
	});
	it('keeps absolute and same-sheet refs correct', () => {
		expect(translateFormula('=$A$1', 1, 1)).toBe('=$A$1');
		expect(translateFormula('=A1', 1, 0)).toBe('=A2');
	});
	it('preserves single-quoted sheet names containing ref-like tokens', () => {
		expect(translateFormula("='Plan B2'!A1", 1, 0)).toBe("='Plan B2'!A2");
		expect(translateFormula("='Sheet A1'!B2+C3", 1, 0)).toBe("='Sheet A1'!B3+C4");
	});
});
