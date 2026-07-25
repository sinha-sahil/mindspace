/**
 * Obsidian-style "live preview" for the markdown editor.
 *
 * One view, two faces: the document reads as rendered prose — syntax marks
 * hidden, tasks as real checkboxes, `---` as a rule, mermaid fences as
 * rendered diagrams — but any line the cursor touches reveals its raw
 * markdown for editing. (Obsidian itself is closed-source; this recreates
 * the interaction natively on CodeMirror 6 with decorations.)
 *
 * Reveal rule (sticky): placing the caret in a line — or clicking into a
 * table/mermaid block — reveals that region's raw markdown, and it STAYS
 * revealed while the selection remains inside it, so selecting text within
 * the region you're editing never flips it back to preview. Drag gestures
 * that start outside a revealed region never reveal anything: highlighting
 * across rendered prose, tables, or diagrams keeps the layout perfectly
 * still (the Google-Docs select-to-comment feel).
 */
import {
	EditorView,
	Decoration,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import {
	StateField,
	StateEffect,
	type EditorState,
	type Extension,
	type Range
} from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
	renderMermaidDiagrams,
	renderInlineMarkdown,
	MERMAID_FULLSCREEN_BTN_CLASS
} from './markdown';

/* ==========================================================================
   Widgets
   ========================================================================== */

class BulletWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		const s = document.createElement('span');
		s.className = 'livemd-bullet';
		s.textContent = '•';
		return s;
	}
	ignoreEvent(): boolean {
		return false;
	}
}
const BULLET = new BulletWidget();

class CheckboxWidget extends WidgetType {
	constructor(
		readonly checked: boolean,
		/** Doc position of the char inside `[ ]` / `[x]`. */
		readonly statePos: number
	) {
		super();
	}
	eq(other: CheckboxWidget): boolean {
		return other.checked === this.checked && other.statePos === this.statePos;
	}
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('span');
		wrap.className = 'livemd-task';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = this.checked;
		input.setAttribute('aria-label', this.checked ? 'Mark task not done' : 'Mark task done');
		input.addEventListener('mousedown', (e) => e.preventDefault());
		input.addEventListener('click', (e) => {
			e.preventDefault();
			view.dispatch({
				changes: { from: this.statePos, to: this.statePos + 1, insert: this.checked ? ' ' : 'x' },
				userEvent: 'input'
			});
		});
		wrap.appendChild(input);
		return wrap;
	}
	ignoreEvent(event: Event): boolean {
		// Let the checkbox own its clicks; everything else goes to the editor.
		return event.type === 'click' || event.type === 'mousedown';
	}
}

class HrWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = 'livemd-hr';
		return el;
	}
	ignoreEvent(): boolean {
		return false;
	}
}
const HR = new HrWidget();

class MermaidWidget extends WidgetType {
	constructor(
		readonly src: string,
		/** Position just inside the fence — where a click drops the cursor. */
		readonly editPos: number
	) {
		super();
	}
	eq(other: MermaidWidget): boolean {
		return other.src === this.src;
	}
	toDOM(view: EditorView): HTMLElement {
		const host = document.createElement('div');
		host.className = 'livemd-mermaid';
		const pre = document.createElement('pre');
		pre.className = 'mermaid-diagram';
		pre.textContent = this.src;
		host.appendChild(pre);
		// Same pipeline (and SVG cache) as the reader — flicker-free re-mounts.
		void renderMermaidDiagrams(host);
		host.addEventListener('click', (e) => {
			const t = e.target;
			// The fullscreen button is handled globally by MermaidFullscreen.
			if (t instanceof Element && t.closest(`.${MERMAID_FULLSCREEN_BTN_CLASS}`)) {
				return;
			}
			view.dispatch({
				selection: { anchor: Math.min(this.editPos, view.state.doc.length) },
				scrollIntoView: true
			});
			view.focus();
		});
		return host;
	}
	ignoreEvent(event: Event): boolean {
		return event.type === 'click';
	}
	get estimatedHeight(): number {
		return 220;
	}
}

/** Split a GFM table row into cells: unescaped `|` delimits, `\|` survives. */
function splitRow(line: string): string[] {
	let t = line.trim();
	if (t.startsWith('|')) {
		t = t.slice(1);
	}
	if (t.endsWith('|') && !t.endsWith('\\|')) {
		t = t.slice(0, -1);
	}
	const cells: string[] = [];
	let cur = '';
	for (let i = 0; i < t.length; i++) {
		const ch = t[i];
		if (ch === '\\' && t[i + 1] === '|') {
			cur += '\\|';
			i++;
		} else if (ch === '|') {
			cells.push(cur.trim());
			cur = '';
		} else {
			cur += ch;
		}
	}
	cells.push(cur.trim());
	return cells;
}

function alignOf(delim: string): '' | 'left' | 'center' | 'right' {
	const d = delim.trim();
	const l = d.startsWith(':');
	const r = d.endsWith(':');
	if (l && r) {
		return 'center';
	}
	if (r) {
		return 'right';
	}
	if (l) {
		return 'left';
	}
	return '';
}

class TableWidget extends WidgetType {
	constructor(
		readonly src: string,
		/** Doc position of the table's first character. */
		readonly from: number
	) {
		super();
	}
	eq(other: TableWidget): boolean {
		return other.src === this.src;
	}
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'livemd-tablewrap';
		const table = document.createElement('table');
		table.className = 'livemd-table';

		const lines = this.src.split('\n');
		// Row → doc offset of its line start, so a click lands the cursor on
		// the row being edited.
		let offset = 0;
		const rows: { text: string; at: number }[] = [];
		for (const line of lines) {
			rows.push({ text: line, at: offset });
			offset += line.length + 1;
		}
		const header = rows[0];
		const delim = rows[1];
		const aligns = delim ? splitRow(delim.text).map(alignOf) : [];

		const jump = (at: number) => {
			const pos = Math.min(this.from + at, view.state.doc.length);
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
			view.focus();
		};

		const fillRow = (tr: HTMLTableRowElement, line: string, tag: 'th' | 'td', at: number) => {
			splitRow(line).forEach((cell, i) => {
				const el = document.createElement(tag);
				// renderInlineMarkdown sanitizes through the shared DOMPurify pass.
				el.innerHTML = renderInlineMarkdown(cell);
				const a = aligns[i];
				if (a) {
					el.style.textAlign = a;
				}
				tr.appendChild(el);
			});
			tr.addEventListener('click', () => jump(at));
		};

		if (header) {
			const thead = document.createElement('thead');
			const tr = document.createElement('tr');
			fillRow(tr, header.text, 'th', header.at);
			thead.appendChild(tr);
			table.appendChild(thead);
		}
		const tbody = document.createElement('tbody');
		for (const row of rows.slice(2)) {
			if (!row.text.trim()) {
				continue;
			}
			const tr = document.createElement('tr');
			fillRow(tr, row.text, 'td', row.at);
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		wrap.appendChild(table);
		return wrap;
	}
	ignoreEvent(event: Event): boolean {
		return event.type === 'click';
	}
	get estimatedHeight(): number {
		return Math.max(64, this.src.split('\n').length * 34);
	}
}

/* ==========================================================================
   Decoration builder
   ========================================================================== */

const hide = Decoration.replace({});
const codeChip = Decoration.mark({ class: 'livemd-code' });
const linkText = Decoration.mark({ class: 'livemd-link' });
const quoteLine = Decoration.line({ class: 'livemd-quote' });
const codeBlockLine = Decoration.line({ class: 'livemd-codeline' });
const fenceLine = Decoration.line({ class: 'livemd-fence' });
const taskDoneLine = Decoration.line({ class: 'livemd-task-done' });

/* --------------------------------------------------------------------------
   Sticky reveal state

   The regions whose raw markdown is currently shown for editing. Two forces
   pull against each other here:

   - Selecting text to comment/copy must never shift the layout — so a drag
     that starts in preview reveals nothing (the earlier caret-only rule).
   - Editing must not flicker — once a caret has revealed a line or a table,
     selecting text INSIDE that region has to keep it revealed, otherwise
     every drag inside a table snaps it back to a widget mid-gesture.

   The resolution: reveals are sticky. A caret adds its line (or its whole
   table/mermaid block) to the revealed set; a non-empty selection keeps
   whatever revealed regions it overlaps and adds nothing new. Pointer
   gestures defer their caret's reveal to mouseup (revealRecompute), so
   mousedown at the start of a drag doesn't flash raw markdown.
   -------------------------------------------------------------------------- */

type Span = { from: number; to: number };

/** Dispatched on mouseup so a plain click applies its reveal once the
 *  gesture is over (mid-drag transactions never add reveals). */
const revealRecompute = StateEffect.define<null>();

function blockAncestor(state: EditorState, pos: number, side: -1 | 1): SyntaxNode | null {
	let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
	while (node) {
		if (node.name === 'Table' || node.name === 'FencedCode') {
			return node;
		}
		node = node.parent;
	}
	return null;
}

/** The region a caret at `pos` reveals: the whole table/fence it sits in,
 *  or just its line. Whole-block units are what make clicking between two
 *  rows of a revealed table seamless. */
function revealUnitAt(state: EditorState, pos: number): Span {
	const block = blockAncestor(state, pos, 1) ?? blockAncestor(state, pos, -1);
	if (block) {
		return { from: state.doc.lineAt(block.from).from, to: state.doc.lineAt(block.to).to };
	}
	const line = state.doc.lineAt(pos);
	return { from: line.from, to: line.to };
}

function mergeSpans(spans: Span[]): Span[] {
	if (spans.length < 2) {
		return spans;
	}
	const sorted = [...spans].sort((a, b) => a.from - b.from);
	const out: Span[] = [{ ...sorted[0] }];
	for (const s of sorted.slice(1)) {
		const last = out[out.length - 1];
		if (s.from <= last.to) {
			last.to = Math.max(last.to, s.to);
		} else {
			out.push({ ...s });
		}
	}
	return out;
}

function sameSpans(a: readonly Span[], b: readonly Span[]): boolean {
	return a.length === b.length && a.every((s, i) => s.from === b[i].from && s.to === b[i].to);
}

function computeReveal(state: EditorState, prev: readonly Span[], allowAdd: boolean): Span[] {
	const next: Span[] = [];
	for (const range of state.selection.ranges) {
		if (range.empty) {
			if (allowAdd) {
				next.push(revealUnitAt(state, range.head));
			} else {
				for (const s of prev) {
					if (range.head >= s.from && range.head <= s.to) {
						next.push({ ...s });
					}
				}
			}
		} else {
			for (const s of prev) {
				if (s.to >= range.from && s.from <= range.to) {
					next.push({ ...s });
				}
			}
		}
	}
	return mergeSpans(next);
}

const revealField = StateField.define<readonly Span[]>({
	create(state) {
		return computeReveal(state, [], true);
	},
	update(spans, tr) {
		let mapped: readonly Span[] = spans;
		if (tr.docChanged) {
			mapped = spans.map((s) => ({
				from: tr.changes.mapPos(s.from),
				to: tr.changes.mapPos(s.to, 1)
			}));
		}
		const recompute = tr.effects.some((e) => e.is(revealRecompute));
		if (!tr.selection && !recompute) {
			return sameSpans(mapped, spans) ? spans : mapped;
		}
		const allowAdd = recompute || !tr.isUserEvent('select.pointer');
		const next = computeReveal(tr.state, mapped, allowAdd);
		return sameSpans(next, spans) ? spans : next;
	}
});

/** Window-level mouseup watcher: pointer gestures suppress reveals while the
 *  button is down; this applies the deferred reveal when it comes back up
 *  (even if the release happens outside the editor). */
const pointerRelease = ViewPlugin.fromClass(
	class {
		active = false;
		alive = true;
		constructor(readonly view: EditorView) {
			window.addEventListener('mouseup', this.up);
		}
		up = (): void => {
			if (!this.active) {
				return;
			}
			this.active = false;
			setTimeout(() => {
				if (this.alive) {
					this.view.dispatch({ effects: revealRecompute.of(null) });
				}
			}, 0);
		};
		destroy(): void {
			this.alive = false;
			window.removeEventListener('mouseup', this.up);
		}
	},
	{
		eventHandlers: {
			mousedown(): boolean {
				this.active = true;
				return false;
			}
		}
	}
);

function revealedLines(state: EditorState): Set<number> {
	const lines = new Set<number>();
	const max = state.doc.length;
	for (const s of state.field(revealField)) {
		const first = state.doc.lineAt(Math.min(s.from, max)).number;
		const last = state.doc.lineAt(Math.min(s.to, max)).number;
		for (let n = first; n <= last; n++) {
			lines.add(n);
		}
	}
	return lines;
}

/** True when a revealed region overlaps [from, to]. */
function revealOverlaps(state: EditorState, from: number, to: number): boolean {
	return state.field(revealField).some((s) => s.to >= from && s.from <= to);
}

function fenceLang(state: EditorState, node: { from: number; to: number }): string {
	const src = state.doc.sliceString(node.from, Math.min(node.from + 40, node.to));
	return (src.match(/^(?:`{3,}|~{3,})[ \t]*([\w#+-]*)/)?.[1] ?? '').toLowerCase();
}

function isLiveMermaid(state: EditorState, node: { from: number; to: number }): boolean {
	return fenceLang(state, node) === 'mermaid' && !revealOverlaps(state, node.from, node.to);
}

/** A table renders as a widget only when no revealed region touches it AND
 *  it starts at a line start (indented/quoted tables keep their raw source). */
function isLiveTable(state: EditorState, node: { from: number; to: number }): boolean {
	return (
		!revealOverlaps(state, node.from, node.to) && state.doc.lineAt(node.from).from === node.from
	);
}

/* Block-level decorations (widgets that swap whole lines, affecting vertical
   layout) must come from a StateField — CodeMirror forbids ViewPlugins from
   providing block decorations. Mermaid diagrams and tables both live here. */
function buildBlockWidgets(state: EditorState): DecorationSet {
	const decos: Range<Decoration>[] = [];
	syntaxTree(state).iterate({
		enter: (node): boolean | void => {
			if (node.name === 'FencedCode') {
				if (isLiveMermaid(state, node)) {
					const firstLine = state.doc.lineAt(node.from);
					const lastLine = state.doc.lineAt(node.to);
					const innerFrom = Math.min(firstLine.to + 1, node.to);
					const inner = state.doc.sliceString(innerFrom, Math.max(lastLine.from - 1, node.from));
					decos.push(
						Decoration.replace({
							widget: new MermaidWidget(inner, innerFrom),
							block: true
						}).range(node.from, node.to)
					);
				}
				return false;
			}
			if (node.name === 'Table') {
				if (isLiveTable(state, node)) {
					decos.push(
						Decoration.replace({
							widget: new TableWidget(state.doc.sliceString(node.from, node.to), node.from),
							block: true
						}).range(node.from, node.to)
					);
				}
				return false;
			}
			return;
		}
	});
	return Decoration.set(decos, true);
}

const blockWidgetField = StateField.define<{ decos: DecorationSet; treeLen: number }>({
	create(state) {
		return { decos: buildBlockWidgets(state), treeLen: syntaxTree(state).length };
	},
	update(value, tr) {
		// Rebuild when the doc or the revealed set changes, or when the syntax
		// tree has grown — on large documents the parser reaches distant
		// tables/diagrams after idle parsing, without any other change to
		// piggyback on. Plain selection changes don't matter: reveal state is
		// the only selection-derived input to the widgets.
		const treeLen = syntaxTree(tr.state).length;
		const revealChanged = tr.state.field(revealField) !== tr.startState.field(revealField);
		if (tr.docChanged || revealChanged || treeLen !== value.treeLen) {
			return { decos: buildBlockWidgets(tr.state), treeLen };
		}
		return value;
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.decos)
});

function buildDecorations(view: EditorView): DecorationSet {
	const state = view.state;
	const decos: Range<Decoration>[] = [];
	const lineDecos: Range<Decoration>[] = [];
	const revealed = revealedLines(state);
	const doc = state.doc;

	const lineRevealed = (pos: number) => revealed.has(doc.lineAt(pos).number);

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node): boolean | void => {
				const name = node.name;

				/* ---- multi-line blocks (widgets come from the field) ---- */
				if (name === 'Table') {
					// Widget-replaced tables need no inline decorations; revealed
					// tables keep their raw source styling.
					if (isLiveTable(state, node)) {
						return false;
					}
					return;
				}
				if (name === 'FencedCode') {
					if (isLiveMermaid(state, node)) {
						return false; // replaced by the block widget
					}
					// Regular (or revealed-mermaid) code block: tint every line,
					// dim the fences.
					const first = doc.lineAt(node.from).number;
					const last = doc.lineAt(node.to).number;
					for (let n = first; n <= last; n++) {
						const line = doc.line(n);
						lineDecos.push(codeBlockLine.range(line.from));
						if (n === first || n === last) {
							lineDecos.push(fenceLine.range(line.from));
						}
					}
					return;
				}

				/* ---- single-line block elements ---- */
				if (name === 'HorizontalRule') {
					if (!lineRevealed(node.from)) {
						decos.push(Decoration.replace({ widget: HR }).range(node.from, node.to));
					}
					return false;
				}

				if (name === 'Blockquote') {
					const first = doc.lineAt(node.from).number;
					const last = doc.lineAt(node.to).number;
					for (let n = first; n <= last; n++) {
						lineDecos.push(quoteLine.range(doc.line(n).from));
					}
					return;
				}

				if (name === 'QuoteMark') {
					if (!lineRevealed(node.from)) {
						// Swallow the trailing space too so quoted text left-aligns.
						const after = doc.sliceString(node.to, node.to + 1);
						decos.push(hide.range(node.from, after === ' ' ? node.to + 1 : node.to));
					}
					return;
				}

				if (name === 'HeaderMark') {
					// ATX `#` prefix (setext underlines stay visible — rare).
					const line = doc.lineAt(node.from);
					if (doc.sliceString(node.from, node.from + 1) === '#' && !revealed.has(line.number)) {
						const after = doc.sliceString(node.to, node.to + 1);
						decos.push(hide.range(node.from, after === ' ' ? node.to + 1 : node.to));
					}
					return;
				}

				if (name === 'ListMark') {
					const line = doc.lineAt(node.from);
					if (revealed.has(line.number)) {
						return;
					}
					const markText = doc.sliceString(node.from, node.to);
					if (!/^\d/.test(markText)) {
						// Bullet (or task — the TaskMarker node follows separately).
						const rest = doc.sliceString(node.to, Math.min(node.to + 4, line.to));
						const task = rest.match(/^ \[( |x|X)\]/);
						if (task) {
							const statePos = node.to + 2;
							const checked = task[1].toLowerCase() === 'x';
							decos.push(
								Decoration.replace({
									widget: new CheckboxWidget(checked, statePos)
								}).range(node.from, node.to + 4)
							);
							if (checked) {
								lineDecos.push(taskDoneLine.range(line.from));
							}
						} else {
							decos.push(Decoration.replace({ widget: BULLET }).range(node.from, node.to));
						}
					}
					return;
				}

				/* ---- inline formatting marks ---- */
				if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
					if (!lineRevealed(node.from)) {
						decos.push(hide.range(node.from, node.to));
					}
					return;
				}

				if (name === 'InlineCode') {
					decos.push(codeChip.range(node.from, node.to));
					if (!lineRevealed(node.from)) {
						// Hide the backtick CodeMarks at each end.
						const c = node.node.cursor();
						if (c.firstChild()) {
							do {
								if (c.name === 'CodeMark') {
									decos.push(hide.range(c.from, c.to));
								}
							} while (c.nextSibling());
						}
					}
					return false;
				}

				if (name === 'Link' || name === 'Image') {
					if (lineRevealed(node.from)) {
						return;
					}
					// GitHub-style callout tags (`> [!NOTE]`) parse as shortcut
					// links — render them as a small colored badge, not a link.
					const raw = doc.sliceString(node.from, node.to);
					const callout = raw.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
					if (callout) {
						decos.push(hide.range(node.from, node.from + 2));
						decos.push(
							Decoration.mark({
								class: `livemd-callout livemd-callout-${callout[1].toLowerCase()}`
							}).range(node.from + 2, node.to - 1)
						);
						decos.push(hide.range(node.to - 1, node.to));
						return false;
					}
					// Hide `[` / `![`, then everything from `](` to the end.
					const n = node.node;
					let closeBracket: SyntaxNode | null = null;
					const c = n.cursor();
					if (c.firstChild()) {
						do {
							if (c.name === 'LinkMark') {
								const text = doc.sliceString(c.from, c.to);
								if (text === '[' || text === '![') {
									decos.push(hide.range(c.from, c.to));
								} else if (text === ']' && closeBracket === null) {
									closeBracket = c.node;
								}
							}
						} while (c.nextSibling());
					}
					if (closeBracket) {
						decos.push(hide.range(closeBracket.from, n.to));
						decos.push(linkText.range(n.from, closeBracket.from));
					}
					return false;
				}

				return;
			}
		});
	}

	// A single sorted set: line decorations first at equal positions.
	return Decoration.set([...lineDecos, ...decos], true);
}

/* ==========================================================================
   Plugin
   ========================================================================== */

export function livePreview(): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = buildDecorations(view);
			}
			update(u: ViewUpdate) {
				const revealChanged = u.state.field(revealField) !== u.startState.field(revealField);
				if (u.docChanged || u.viewportChanged || revealChanged) {
					this.decorations = buildDecorations(u.view);
				}
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				mousedown(event, view) {
					// Cmd/Ctrl+click on a live link opens it in a new tab.
					if (!(event.metaKey || event.ctrlKey)) {
						return false;
					}
					const target = event.target;
					if (!(target instanceof Element) || !target.closest('.livemd-link')) {
						return false;
					}
					const pos = view.posAtDOM(target);
					const tree = syntaxTree(view.state);
					let node: SyntaxNode | null = tree.resolveInner(pos, 1);
					while (node && node.name !== 'Link' && node.name !== 'Image') {
						node = node.parent;
					}
					if (!node) {
						return false;
					}
					const url = node.getChild('URL');
					if (!url) {
						return false;
					}
					const href = view.state.doc.sliceString(url.from, url.to);
					if (/^https?:\/\//i.test(href)) {
						window.open(href, '_blank', 'noopener,noreferrer');
						event.preventDefault();
						return true;
					}
					return false;
				}
			}
		}
	);
	return [revealField, pointerRelease, blockWidgetField, plugin];
}
