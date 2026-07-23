/**
 * Obsidian-style "live preview" for the markdown editor.
 *
 * One view, two faces: the document reads as rendered prose — syntax marks
 * hidden, tasks as real checkboxes, `---` as a rule, mermaid fences as
 * rendered diagrams — but any line the cursor touches reveals its raw
 * markdown for editing. (Obsidian itself is closed-source; this recreates
 * the interaction natively on CodeMirror 6 with decorations.)
 *
 * Reveal rule: a line is "revealed" when any selection range touches it.
 * Multi-line blocks (fenced code, mermaid) reveal when the selection
 * intersects the block anywhere.
 */
import {
	EditorView,
	Decoration,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { renderMermaidDiagrams, MERMAID_FULLSCREEN_BTN_CLASS } from './markdown';

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

/** Lines touched by any selection range. */
function revealedLines(state: EditorState): Set<number> {
	const lines = new Set<number>();
	for (const range of state.selection.ranges) {
		const from = state.doc.lineAt(range.from).number;
		const to = state.doc.lineAt(range.to).number;
		for (let n = from; n <= to; n++) {
			lines.add(n);
		}
	}
	return lines;
}

function selectionIntersects(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((r) => r.to >= from && r.from <= to);
}

function fenceLang(state: EditorState, node: { from: number; to: number }): string {
	const src = state.doc.sliceString(node.from, Math.min(node.from + 40, node.to));
	return (src.match(/^(?:`{3,}|~{3,})[ \t]*([\w#+-]*)/)?.[1] ?? '').toLowerCase();
}

function isLiveMermaid(state: EditorState, node: { from: number; to: number }): boolean {
	return fenceLang(state, node) === 'mermaid' && !selectionIntersects(state, node.from, node.to);
}

/* Block-level decorations (the mermaid widget swaps whole lines, which
   affects vertical layout) must come from a StateField — CodeMirror forbids
   ViewPlugins from providing block decorations. */
function buildMermaidDecos(state: EditorState): DecorationSet {
	const decos: Range<Decoration>[] = [];
	syntaxTree(state).iterate({
		enter: (node): boolean | void => {
			if (node.name !== 'FencedCode') {
				return;
			}
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
	});
	return Decoration.set(decos, true);
}

const mermaidField = StateField.define<DecorationSet>({
	create: buildMermaidDecos,
	update(value, tr) {
		return tr.docChanged || tr.selection ? buildMermaidDecos(tr.state) : value;
	},
	provide: (f) => EditorView.decorations.from(f)
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

				/* ---- multi-line: fenced code (mermaid handled by the field) ---- */
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
				if (u.docChanged || u.selectionSet || u.viewportChanged) {
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
	return [mermaidField, plugin];
}
