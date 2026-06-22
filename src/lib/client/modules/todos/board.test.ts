import { describe, it, expect } from 'vitest';
import * as B from './board';

describe('todo board', () => {
	it('parses empty/garbage to a starter board', () => {
		expect(B.parseBoard('').columns.length).toBe(1);
		expect(B.parseBoard('not json').columns[0].nodes.length).toBe(1);
		expect(B.parseBoard(null).columns[0].title).toBe('To do');
	});

	it('indents under previous sibling and outdents back', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		const a = B.newTask('a');
		const c = B.newTask('b');
		col.nodes = [a, c];
		B.indentNode(b, c.id);
		expect(col.nodes.length).toBe(1);
		expect(col.nodes[0].children[0].id).toBe(c.id);
		B.outdentNode(b, c.id);
		expect(col.nodes.length).toBe(2);
		expect(col.nodes[1].id).toBe(c.id);
	});

	it('first item cannot indent', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		const a = B.newTask('a');
		col.nodes = [a];
		B.indentNode(b, a.id);
		expect(col.nodes.length).toBe(1);
		expect(col.nodes[0].children.length).toBe(0);
	});

	it('toggling a parent cascades to descendants', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		const p = B.newTask('p');
		const c1 = B.newTask('c1');
		const c2 = B.newTask('c2');
		p.children = [c1, c2];
		col.nodes = [p];
		B.toggleDone(b, p.id);
		expect(p.done && c1.done && c2.done).toBe(true);
		B.toggleDone(b, p.id);
		expect(p.done || c1.done || c2.done).toBe(false);
	});

	it('addSiblingAfter / addChild place nodes correctly', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		const a = col.nodes[0];
		const sib = B.addSiblingAfter(b, a.id)!;
		expect(col.nodes[1].id).toBe(sib.id);
		const child = B.addChild(b, a.id)!;
		expect(a.children[0].id).toBe(child.id);
	});

	it('counts progress over nested tasks, ignoring sections', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		const s = B.newSection('S');
		const t1 = B.newTask('t1');
		const t2 = B.newTask('t2');
		t2.done = true;
		s.children = [t1, t2];
		col.nodes = [s];
		expect(B.countProgress(col.nodes)).toEqual({ done: 1, total: 2 });
	});

	it('roundtrips through serialize/parse', () => {
		const b = B.createEmptyBoard();
		B.setText(b, b.columns[0].nodes[0].id, 'hello');
		const again = B.parseBoard(B.serializeBoard(b));
		expect(again.columns[0].nodes[0].text).toBe('hello');
	});

	it('removeColumn keeps at least one column', () => {
		const b = B.createEmptyBoard();
		B.removeColumn(b, b.columns[0].id);
		expect(b.columns.length).toBe(1);
	});
});
