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

	it('gives every column canvas geometry and a viewport', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		expect(typeof col.x).toBe('number');
		expect(typeof col.y).toBe('number');
		expect(col.width).toBe(B.DEFAULT_COLUMN_WIDTH);
		expect(b.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
	});

	it('migrates legacy (positionless) columns into a row layout', () => {
		const legacy = JSON.stringify({
			columns: [
				{ id: 'a', title: 'A', nodes: [] },
				{ id: 'b', title: 'B', nodes: [] }
			]
		});
		const b = B.parseBoard(legacy);
		expect(b.columns[0].x).toBeLessThan(b.columns[1].x);
		expect(b.columns[0].y).toBe(b.columns[1].y);
		expect(b.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
	});

	it('addColumn places a card at an explicit canvas position', () => {
		const b = B.createEmptyBoard();
		const col = B.addColumn(b, { x: 500, y: 220 });
		expect(col.x).toBe(500);
		expect(col.y).toBe(220);
		B.setColumnPosition(b, col.id, 10, 20);
		expect(b.columns.find((c) => c.id === col.id)?.x).toBe(10);
	});

	it('persists viewport pan/zoom across serialize/parse', () => {
		const b = B.createEmptyBoard();
		B.setViewport(b, { x: -120, y: 80, zoom: 1.5 });
		const again = B.parseBoard(B.serializeBoard(b));
		expect(again.viewport).toEqual({ x: -120, y: 80, zoom: 1.5 });
	});

	it('cycles effort/time ratings 0→1→2→3→0 and persists them', () => {
		const b = B.createEmptyBoard();
		const t = b.columns[0].nodes[0];
		expect(t.effort).toBe(0);
		for (const expected of [1, 2, 3, 0]) {
			B.cycleEffort(b, t.id);
			expect(t.effort).toBe(expected);
		}
		B.cycleTime(b, t.id);
		const again = B.parseBoard(B.serializeBoard(b));
		expect(again.columns[0].nodes[0].time).toBe(1);
	});

	it('sorts tasks by rating (desc) without mutating the stored order', () => {
		const b = B.createEmptyBoard();
		const col = b.columns[0];
		const low = B.newTask('low');
		low.effort = 1;
		const high = B.newTask('high');
		high.effort = 3;
		const none = B.newTask('none');
		col.nodes = [low, high, none];
		const sorted = B.viewNodes(col.nodes, { sort: 'effort', hideDone: false });
		expect(sorted.map((n) => n.text)).toEqual(['high', 'low', 'none']);
		// non-destructive: the board keeps manual order
		expect(col.nodes.map((n) => n.text)).toEqual(['low', 'high', 'none']);
	});

	it('keeps section headings pinned above tasks when sorting', () => {
		const s = B.newSection('Heading');
		const t = B.newTask('task');
		t.effort = 3;
		const sorted = B.viewNodes([t, s], { sort: 'effort', hideDone: false });
		expect(sorted[0].kind).toBe('section');
	});

	it('hideDone filters out completed tasks for display only', () => {
		const a = B.newTask('a');
		const done = B.newTask('done');
		done.done = true;
		const shown = B.viewNodes([a, done], { sort: 'manual', hideDone: true });
		expect(shown.map((n) => n.text)).toEqual(['a']);
	});

	it('persists view sort/hideDone across serialize/parse', () => {
		const b = B.createEmptyBoard();
		B.setView(b, { sort: 'time', hideDone: true });
		const again = B.parseBoard(B.serializeBoard(b));
		expect(again.view).toEqual({ sort: 'time', hideDone: true });
	});
});
