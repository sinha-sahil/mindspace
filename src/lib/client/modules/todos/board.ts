/**
 * Pure data model + tree operations for todo-list projects.
 *
 * A todo project stores its entire board in `project.scene` (JSONB) — exactly
 * how whiteboard projects store their Excalidraw scene. No extra tables. The
 * functions here operate on plain objects so they're trivially testable; the
 * UI holds the board in `$state` and calls these to mutate it, then serializes
 * the whole thing back through `projects.saveScene`.
 *
 * A board is a list of columns (the multi-column view). Each column holds an
 * ordered list of nodes. A node is either a `task` (a checkbox item) or a
 * `section` (a heading). Both can have nested children, which is what gives us
 * nested todos and grouped sub-lists.
 */

export type TodoNodeKind = 'task' | 'section';

export type TodoNode = {
	id: string;
	kind: TodoNodeKind;
	text: string;
	/** Only meaningful for `task` nodes. */
	done: boolean;
	collapsed: boolean;
	children: TodoNode[];
};

export type TodoColumn = {
	id: string;
	title: string;
	nodes: TodoNode[];
	/** Position on the free canvas, in world (pre-zoom) coordinates. */
	x: number;
	y: number;
	width: number;
};

/** Pan/zoom of the canvas, persisted so the view is restored on reopen. */
export type TodoViewport = {
	x: number;
	y: number;
	zoom: number;
};

export type TodoBoard = {
	version: 1;
	columns: TodoColumn[];
	viewport: TodoViewport;
};

export const DEFAULT_COLUMN_WIDTH = 300;
/** Spacing used when laying out columns that have no saved position (legacy). */
const LAYOUT_GAP = 28;
const LAYOUT_ORIGIN = 40;

function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Deterministic-ish fallback for non-browser/test contexts.
	return 'id-' + Math.abs(Math.floor(performance.now() * 1000)).toString(36) + len36();
}

let counter = 0;
function len36(): string {
	counter = (counter + 1) % 1_000_000;
	return counter.toString(36);
}

export function newTask(text = ''): TodoNode {
	return { id: uid(), kind: 'task', text, done: false, collapsed: false, children: [] };
}

export function newSection(text = ''): TodoNode {
	return { id: uid(), kind: 'section', text, done: false, collapsed: false, children: [] };
}

export function newColumn(
	title = 'New column',
	x = LAYOUT_ORIGIN,
	y = LAYOUT_ORIGIN,
	width = DEFAULT_COLUMN_WIDTH
): TodoColumn {
	return { id: uid(), title, nodes: [newTask('')], x, y, width };
}

export function createEmptyBoard(): TodoBoard {
	return {
		version: 1,
		columns: [newColumn('To do', LAYOUT_ORIGIN, LAYOUT_ORIGIN)],
		viewport: { x: 0, y: 0, zoom: 1 }
	};
}

/** Parse a stored scene string into a board, tolerating empty/legacy/garbage. */
export function parseBoard(scene: string | null): TodoBoard {
	if (!scene) {
		return createEmptyBoard();
	}
	try {
		return normalizeBoard(JSON.parse(scene));
	} catch {
		return createEmptyBoard();
	}
}

export function serializeBoard(board: TodoBoard): string {
	return JSON.stringify(board);
}

// We never trust the stored shape — scene JSON could be empty, legacy, or hand
// edited. Narrow everything explicitly via the `in` operator (no assertions).
function normalizeNode(raw: unknown): TodoNode | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const kind: TodoNodeKind = 'kind' in raw && raw.kind === 'section' ? 'section' : 'task';
	const children: TodoNode[] = [];
	if ('children' in raw && Array.isArray(raw.children)) {
		for (const child of raw.children) {
			const node = normalizeNode(child);
			if (node) {
				children.push(node);
			}
		}
	}
	return {
		id: 'id' in raw && typeof raw.id === 'string' ? raw.id : uid(),
		kind,
		text: 'text' in raw && typeof raw.text === 'string' ? raw.text : '',
		done: kind === 'task' && 'done' in raw && raw.done === true,
		collapsed: 'collapsed' in raw && raw.collapsed === true,
		children
	};
}

function normalizeBoard(raw: unknown): TodoBoard {
	if (
		typeof raw !== 'object' ||
		raw === null ||
		!('columns' in raw) ||
		!Array.isArray(raw.columns)
	) {
		return createEmptyBoard();
	}
	const columns: TodoColumn[] = [];
	for (const c of raw.columns) {
		if (typeof c !== 'object' || c === null) {
			continue;
		}
		const nodes: TodoNode[] = [];
		if ('nodes' in c && Array.isArray(c.nodes)) {
			for (const n of c.nodes) {
				const node = normalizeNode(n);
				if (node) {
					nodes.push(node);
				}
			}
		}
		const width = 'width' in c && typeof c.width === 'number' ? c.width : DEFAULT_COLUMN_WIDTH;
		// Boards created before the canvas had no x/y — fall back to the old
		// left-to-right row so existing todo lists open exactly where they were.
		const index = columns.length;
		const x =
			'x' in c && typeof c.x === 'number'
				? c.x
				: LAYOUT_ORIGIN + index * (DEFAULT_COLUMN_WIDTH + LAYOUT_GAP);
		const y = 'y' in c && typeof c.y === 'number' ? c.y : LAYOUT_ORIGIN;
		columns.push({
			id: 'id' in c && typeof c.id === 'string' ? c.id : uid(),
			title: 'title' in c && typeof c.title === 'string' ? c.title : 'Column',
			nodes,
			x,
			y,
			width
		});
	}
	if (columns.length === 0) {
		return createEmptyBoard();
	}
	return { version: 1, columns, viewport: normalizeViewport(raw) };
}

function normalizeViewport(raw: object): TodoViewport {
	if ('viewport' in raw && typeof raw.viewport === 'object' && raw.viewport !== null) {
		const v = raw.viewport;
		return {
			x: 'x' in v && typeof v.x === 'number' ? v.x : 0,
			y: 'y' in v && typeof v.y === 'number' ? v.y : 0,
			zoom: 'zoom' in v && typeof v.zoom === 'number' ? v.zoom : 1
		};
	}
	return { x: 0, y: 0, zoom: 1 };
}

// ----- tree navigation -----

type NodeContext = {
	node: TodoNode;
	/** The array the node lives in (a column's nodes or a parent's children). */
	siblings: TodoNode[];
	index: number;
	parent: TodoNode | null;
	column: TodoColumn;
};

function findContext(board: TodoBoard, id: string): NodeContext | null {
	for (const column of board.columns) {
		const ctx = findIn(column.nodes, id, null, column);
		if (ctx) {
			return ctx;
		}
	}
	return null;
}

function findIn(
	siblings: TodoNode[],
	id: string,
	parent: TodoNode | null,
	column: TodoColumn
): NodeContext | null {
	for (let i = 0; i < siblings.length; i++) {
		const node = siblings[i];
		if (node.id === id) {
			return { node, siblings, index: i, parent, column };
		}
		const inChild = findIn(node.children, id, node, column);
		if (inChild) {
			return inChild;
		}
	}
	return null;
}

// ----- mutations (operate in place on the board) -----

/**
 * Add a column. When `position` is given (canvas world coords) the card lands
 * there; otherwise it's placed just to the right of the rightmost column.
 */
export function addColumn(
	board: TodoBoard,
	position: { x: number; y: number } | null = null
): TodoColumn {
	let x = LAYOUT_ORIGIN;
	let y = LAYOUT_ORIGIN;
	if (position) {
		x = position.x;
		y = position.y;
	} else if (board.columns.length > 0) {
		const right = Math.max(...board.columns.map((c) => c.x + c.width));
		x = right + LAYOUT_GAP;
		y = board.columns[0].y;
	}
	const column = newColumn(`Column ${board.columns.length + 1}`, x, y);
	board.columns.push(column);
	return column;
}

export function setColumnPosition(board: TodoBoard, columnId: string, x: number, y: number): void {
	const column = board.columns.find((c) => c.id === columnId);
	if (column) {
		column.x = x;
		column.y = y;
	}
}

export function setViewport(board: TodoBoard, viewport: TodoViewport): void {
	board.viewport = viewport;
}

export function removeColumn(board: TodoBoard, columnId: string): void {
	board.columns = board.columns.filter((c) => c.id !== columnId);
	if (board.columns.length === 0) {
		board.columns.push(newColumn('To do'));
	}
}

/** Append a new node to the end of a column. */
export function appendToColumn(board: TodoBoard, columnId: string, node: TodoNode): void {
	const column = board.columns.find((c) => c.id === columnId);
	if (column) {
		column.nodes.push(node);
	}
}

/** Insert a sibling immediately after `id` (same level). Returns the new node. */
export function addSiblingAfter(board: TodoBoard, id: string, node = newTask('')): TodoNode | null {
	const ctx = findContext(board, id);
	if (!ctx) {
		return null;
	}
	ctx.siblings.splice(ctx.index + 1, 0, node);
	return node;
}

/** Add a child to `id` (a nested todo). Returns the new node. */
export function addChild(board: TodoBoard, id: string, node = newTask('')): TodoNode | null {
	const ctx = findContext(board, id);
	if (!ctx) {
		return null;
	}
	ctx.node.collapsed = false;
	ctx.node.children.push(node);
	return node;
}

export function removeNode(board: TodoBoard, id: string): void {
	const ctx = findContext(board, id);
	if (!ctx) {
		return;
	}
	ctx.siblings.splice(ctx.index, 1);
}

export function toggleDone(board: TodoBoard, id: string): void {
	const ctx = findContext(board, id);
	if (!ctx || ctx.node.kind !== 'task') {
		return;
	}
	setSubtreeDone(ctx.node, !ctx.node.done);
}

/** Toggling a parent cascades to its descendants — the common expectation. */
function setSubtreeDone(node: TodoNode, done: boolean): void {
	if (node.kind === 'task') {
		node.done = done;
	}
	for (const child of node.children) {
		setSubtreeDone(child, done);
	}
}

export function setText(board: TodoBoard, id: string, text: string): void {
	const ctx = findContext(board, id);
	if (ctx) {
		ctx.node.text = text;
	}
}

export function toggleCollapsed(board: TodoBoard, id: string): void {
	const ctx = findContext(board, id);
	if (ctx) {
		ctx.node.collapsed = !ctx.node.collapsed;
	}
}

export function setNodeKind(board: TodoBoard, id: string, kind: TodoNodeKind): void {
	const ctx = findContext(board, id);
	if (ctx) {
		ctx.node.kind = kind;
		if (kind === 'section') {
			ctx.node.done = false;
		}
	}
}

/** Flip a node between task and section. */
export function toggleNodeKind(board: TodoBoard, id: string): void {
	const ctx = findContext(board, id);
	if (ctx) {
		setNodeKind(board, id, ctx.node.kind === 'task' ? 'section' : 'task');
	}
}

export function renameColumn(board: TodoBoard, columnId: string, title: string): void {
	const column = board.columns.find((c) => c.id === columnId);
	if (column) {
		column.title = title;
	}
}

/**
 * Indent `id` — make it a child of its immediately-preceding sibling. No-op if
 * it's already the first item in its list (nothing to nest under).
 */
export function indentNode(board: TodoBoard, id: string): void {
	const ctx = findContext(board, id);
	if (!ctx || ctx.index === 0) {
		return;
	}
	const previous = ctx.siblings[ctx.index - 1];
	ctx.siblings.splice(ctx.index, 1);
	previous.collapsed = false;
	previous.children.push(ctx.node);
}

/**
 * Outdent `id` — lift it up to sit just after its parent in the grandparent's
 * list. No-op if it's already at the top level of a column.
 */
export function outdentNode(board: TodoBoard, id: string): void {
	const ctx = findContext(board, id);
	if (!ctx || !ctx.parent) {
		return;
	}
	const parentCtx = findContext(board, ctx.parent.id);
	if (!parentCtx) {
		return;
	}
	ctx.siblings.splice(ctx.index, 1);
	parentCtx.siblings.splice(parentCtx.index + 1, 0, ctx.node);
}

/** Move a node up or down among its direct siblings. */
export function moveNode(board: TodoBoard, id: string, direction: -1 | 1): void {
	const ctx = findContext(board, id);
	if (!ctx) {
		return;
	}
	const target = ctx.index + direction;
	if (target < 0 || target >= ctx.siblings.length) {
		return;
	}
	const [node] = ctx.siblings.splice(ctx.index, 1);
	ctx.siblings.splice(target, 0, node);
}

// ----- derived helpers for the UI -----

export type Progress = { done: number; total: number };

/** Count completed vs total task nodes in a subtree (sections don't count). */
export function countProgress(nodes: TodoNode[]): Progress {
	let done = 0;
	let total = 0;
	const walk = (list: TodoNode[]) => {
		for (const n of list) {
			if (n.kind === 'task') {
				total++;
				if (n.done) {
					done++;
				}
			}
			walk(n.children);
		}
	};
	walk(nodes);
	return { done, total };
}
