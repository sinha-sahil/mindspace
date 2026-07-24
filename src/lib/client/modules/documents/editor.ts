/**
 * CodeMirror 6 setup + markdown formatting commands for the document editor.
 *
 * Everything editor-flavored lives here so MarkdownEditor.svelte stays a thin
 * shell: extension assembly (theme, highlighting, keymaps) and the toolbar's
 * command set (inline marks, headings, lists, block inserts) with Google-Docs
 * -style toggle semantics.
 */
import {
	EditorView,
	keymap,
	placeholder as cmPlaceholder,
	drawSelection,
	dropCursor,
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';
import {
	EditorState,
	EditorSelection,
	Prec,
	StateEffect,
	StateField,
	type Extension,
	type Range
} from '@codemirror/state';
import { locateAnchorInText, type Anchor } from './markdown';
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
	undo,
	redo,
	undoDepth,
	redoDepth
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';
import {
	search,
	searchKeymap,
	highlightSelectionMatches,
	openSearchPanel
} from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';

export { undo, redo, undoDepth, redoDepth, openSearchPanel };

/* ==========================================================================
   Inline formatting — toggle `**`/`*`/`~~`/` around the selection. With an
   empty selection the word under the caret is used (Docs behavior); with no
   word, an empty pair is inserted and the caret lands inside it.
   ========================================================================== */

function toggleInline(marker: string) {
	return (view: EditorView): boolean => {
		const { state } = view;
		const len = marker.length;
		const tr = state.changeByRange((range) => {
			let { from, to } = range;
			if (range.empty) {
				const word = state.wordAt(range.head);
				if (word) {
					from = word.from;
					to = word.to;
				}
			}
			const before = state.sliceDoc(Math.max(0, from - len), from);
			const after = state.sliceDoc(to, Math.min(state.doc.length, to + len));
			const inner = state.sliceDoc(from, to);

			if (before === marker && after === marker) {
				// Marked just outside the selection — unwrap.
				return {
					changes: [
						{ from: from - len, to: from },
						{ from: to, to: to + len }
					],
					range: EditorSelection.range(from - len, to - len)
				};
			}
			if (inner.length >= 2 * len && inner.startsWith(marker) && inner.endsWith(marker)) {
				// Markers included in the selection — unwrap.
				return {
					changes: [
						{ from, to: from + len },
						{ from: to - len, to }
					],
					range: EditorSelection.range(from, to - 2 * len)
				};
			}
			if (from === to) {
				return {
					changes: { from, insert: marker + marker },
					range: EditorSelection.cursor(from + len)
				};
			}
			return {
				changes: [
					{ from, insert: marker },
					{ from: to, insert: marker }
				],
				range: EditorSelection.range(from + len, to + len)
			};
		});
		view.dispatch(tr, { scrollIntoView: true, userEvent: 'input' });
		view.focus();
		return true;
	};
}

export const toggleBold = toggleInline('**');
export const toggleItalic = toggleInline('*');
export const toggleStrike = toggleInline('~~');
export const toggleInlineCode = toggleInline('`');

/* ==========================================================================
   Line-prefix formatting — headings, quotes and the three list flavors.
   ========================================================================== */

/** Line-start anatomy: indent, blockquote arrows, list marker, task box. */
const LINE_RE = /^(\s*)((?:>\s*)*)([-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?(#{1,6}\s+)?(.*)$/;

type LineParts = {
	indent: string;
	quotes: string;
	marker: string;
	heading: string;
	rest: string;
};

function splitLine(text: string): LineParts {
	const m = text.match(LINE_RE);
	return {
		indent: m?.[1] ?? '',
		quotes: m?.[2] ?? '',
		marker: m?.[3] ?? '',
		heading: m?.[4] ?? '',
		rest: m?.[5] ?? ''
	};
}

function isTaskMarker(marker: string): boolean {
	return /\[[ xX]\]/.test(marker);
}
function isOrderedMarker(marker: string): boolean {
	return /^\d/.test(marker);
}
function isBulletMarker(marker: string): boolean {
	return marker !== '' && !isOrderedMarker(marker) && !isTaskMarker(marker);
}

/** The doc lines covered by the current selection (all ranges, deduped). */
function selectedLines(state: EditorState) {
	const lines = new Map<number, { from: number; to: number; text: string }>();
	for (const range of state.selection.ranges) {
		const fromLine = state.doc.lineAt(range.from).number;
		// A range ending exactly at a line start shouldn't claim that line.
		const endPos = range.to > range.from ? range.to - 1 : range.to;
		const toLine = state.doc.lineAt(Math.max(range.from, endPos)).number;
		for (let n = fromLine; n <= toLine; n++) {
			const line = state.doc.line(n);
			lines.set(n, { from: line.from, to: line.to, text: line.text });
		}
	}
	return [...lines.values()];
}

function dispatchLineChanges(
	view: EditorView,
	changes: { from: number; to: number; insert: string }[]
): boolean {
	if (changes.length === 0) {
		return true;
	}
	view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
	view.focus();
	return true;
}

/**
 * Set (or toggle off, when the line already matches) a heading level.
 * `level` 0 clears any heading. List/quote prefixes survive the change.
 */
export function setHeading(level: number) {
	return (view: EditorView): boolean => {
		const lines = selectedLines(view.state);
		const allAtLevel = lines.every(
			(l) => l.text.trim() === '' || splitLine(l.text).heading.trim().length === level
		);
		const target = allAtLevel ? 0 : level;
		const changes = lines
			.map((l) => {
				if (l.text.trim() === '') {
					return null;
				}
				const p = splitLine(l.text);
				const hashes = target > 0 ? '#'.repeat(target) + ' ' : '';
				const next = p.indent + p.quotes + p.marker + hashes + p.rest;
				return next === l.text ? null : { from: l.from, to: l.to, insert: next };
			})
			.filter((c) => c !== null);
		return dispatchLineChanges(view, changes);
	};
}

type ListKind = 'bullet' | 'ordered' | 'task';

/** Toggle a list flavor over the selected lines, converting between flavors
 *  in place. Turning a flavor off leaves plain paragraph lines. */
export function toggleList(kind: ListKind) {
	return (view: EditorView): boolean => {
		const lines = selectedLines(view.state);
		const content = lines.filter((l) => l.text.trim() !== '');
		if (content.length === 0) {
			// Empty line: start a fresh list marker right here.
			const insert = kind === 'ordered' ? '1. ' : kind === 'task' ? '- [ ] ' : '- ';
			const pos = view.state.selection.main.head;
			view.dispatch({
				changes: { from: pos, insert },
				selection: EditorSelection.cursor(pos + insert.length),
				userEvent: 'input'
			});
			view.focus();
			return true;
		}
		const matches = (marker: string) =>
			kind === 'task'
				? isTaskMarker(marker)
				: kind === 'ordered'
					? isOrderedMarker(marker)
					: isBulletMarker(marker);
		const allMatch = content.every((l) => matches(splitLine(l.text).marker));

		let n = 0;
		const changes = content
			.map((l) => {
				const p = splitLine(l.text);
				let markerText = '';
				if (!allMatch) {
					n++;
					markerText = kind === 'ordered' ? `${n}. ` : kind === 'task' ? '- [ ] ' : '- ';
				}
				const next = p.indent + p.quotes + markerText + p.heading + p.rest;
				return next === l.text ? null : { from: l.from, to: l.to, insert: next };
			})
			.filter((c) => c !== null);
		return dispatchLineChanges(view, changes);
	};
}

/** Toggle one level of `> ` blockquote over the selected lines. */
export function toggleQuote(view: EditorView): boolean {
	const lines = selectedLines(view.state);
	const content = lines.filter((l) => l.text.trim() !== '');
	const target = content.length > 0 ? content : lines.slice(0, 1);
	if (target.length === 0) {
		return true;
	}
	const allQuoted = target.every((l) => splitLine(l.text).quotes !== '');
	const changes = target
		.map((l) => {
			const next = allQuoted
				? l.text.replace(/^(\s*)>\s?/, '$1')
				: l.text.replace(/^(\s*)/, '$1> ');
			return next === l.text ? null : { from: l.from, to: l.to, insert: next };
		})
		.filter((c) => c !== null);
	return dispatchLineChanges(view, changes);
}

/* ==========================================================================
   Inserts — link, image, table, fenced code, mermaid, horizontal rule.
   ========================================================================== */

const URL_RE = /^https?:\/\/\S+$/i;

export function insertLink(view: EditorView): boolean {
	const { state } = view;
	const range = state.selection.main;
	const sel = state.sliceDoc(range.from, range.to);
	let insert: string;
	let selFrom: number;
	let selTo: number;
	if (sel && URL_RE.test(sel.trim())) {
		// A URL is selected — wrap it and select the empty label.
		insert = `[](${sel.trim()})`;
		selFrom = range.from + 1;
		selTo = selFrom;
	} else if (sel) {
		insert = `[${sel}](url)`;
		selFrom = range.from + sel.length + 3;
		selTo = selFrom + 3;
	} else {
		insert = '[text](url)';
		selFrom = range.from + 1;
		selTo = selFrom + 4;
	}
	view.dispatch({
		changes: { from: range.from, to: range.to, insert },
		selection: EditorSelection.range(selFrom, selTo),
		scrollIntoView: true,
		userEvent: 'input'
	});
	view.focus();
	return true;
}

export function insertImage(view: EditorView): boolean {
	const { state } = view;
	const range = state.selection.main;
	const alt = state.sliceDoc(range.from, range.to) || 'alt text';
	const insert = `![${alt}](url)`;
	const urlFrom = range.from + 2 + alt.length + 2;
	view.dispatch({
		changes: { from: range.from, to: range.to, insert },
		selection: EditorSelection.range(urlFrom, urlFrom + 3),
		scrollIntoView: true,
		userEvent: 'input'
	});
	view.focus();
	return true;
}

/** Insert `text` as its own block: blank-line separated from neighbors.
 *  Returns the offset where `text` itself begins. */
function insertAsBlock(view: EditorView, text: string): number {
	const { state } = view;
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const prevLine = line.number > 1 ? state.doc.line(line.number - 1) : null;
	const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;

	let prefix = '';
	let insertAt: number;
	if (line.text.trim() === '') {
		insertAt = line.from;
		if (prevLine && prevLine.text.trim() !== '') {
			// keep the existing blank line as the separator
		}
	} else {
		insertAt = line.to;
		prefix = '\n\n';
	}
	let suffix = '\n';
	if (nextLine && nextLine.text.trim() !== '') {
		suffix = '\n\n';
	}
	const insert = prefix + text + suffix;
	view.dispatch({
		changes: { from: insertAt, insert },
		scrollIntoView: true,
		userEvent: 'input'
	});
	return insertAt + prefix.length;
}

export function insertTable(view: EditorView): boolean {
	const tpl = [
		'| Column 1 | Column 2 | Column 3 |',
		'| -------- | -------- | -------- |',
		'|          |          |          |',
		'|          |          |          |'
	].join('\n');
	const at = insertAsBlock(view, tpl);
	// Land the caret in the first header cell, selecting its placeholder.
	view.dispatch({ selection: EditorSelection.range(at + 2, at + 10) });
	view.focus();
	return true;
}

export function insertCodeBlock(view: EditorView): boolean {
	const { state } = view;
	const range = state.selection.main;
	const sel = state.sliceDoc(range.from, range.to);
	if (sel) {
		const insert = '```\n' + sel + '\n```';
		view.dispatch({
			changes: { from: range.from, to: range.to, insert },
			selection: EditorSelection.cursor(range.from + 3),
			scrollIntoView: true,
			userEvent: 'input'
		});
		view.focus();
		return true;
	}
	const at = insertAsBlock(view, '```\n\n```');
	view.dispatch({ selection: EditorSelection.cursor(at + 3) });
	view.focus();
	return true;
}

export function insertMermaid(view: EditorView): boolean {
	const tpl = [
		'```mermaid',
		'flowchart TD',
		'  A[Start] --> B{Decision}',
		'  B -->|Yes| C[Ship it]',
		'  B -->|No| D[Iterate]',
		'```'
	].join('\n');
	insertAsBlock(view, tpl);
	view.focus();
	return true;
}

export function insertHr(view: EditorView): boolean {
	insertAsBlock(view, '---');
	view.focus();
	return true;
}

/* ==========================================================================
   Toolbar state — which formats are active at the main cursor.
   ========================================================================== */

export type FormatState = {
	bold: boolean;
	italic: boolean;
	strike: boolean;
	code: boolean;
	quote: boolean;
	bullet: boolean;
	ordered: boolean;
	task: boolean;
	/** 0 = paragraph, 1-6 = heading level at the cursor's line. */
	heading: number;
	canUndo: boolean;
	canRedo: boolean;
};

export function formatStateAt(state: EditorState): FormatState {
	const head = state.selection.main.head;
	const fs: FormatState = {
		bold: false,
		italic: false,
		strike: false,
		code: false,
		quote: false,
		bullet: false,
		ordered: false,
		task: false,
		heading: 0,
		canUndo: undoDepth(state) > 0,
		canRedo: redoDepth(state) > 0
	};
	let node: SyntaxNode | null;
	try {
		node = syntaxTree(state).resolveInner(head, -1);
	} catch {
		node = null;
	}
	while (node) {
		switch (node.name) {
			case 'StrongEmphasis':
				fs.bold = true;
				break;
			case 'Emphasis':
				fs.italic = true;
				break;
			case 'Strikethrough':
				fs.strike = true;
				break;
			case 'InlineCode':
			case 'FencedCode':
			case 'CodeBlock':
				fs.code = true;
				break;
		}
		node = node.parent;
	}
	const p = splitLine(state.doc.lineAt(head).text);
	fs.quote = p.quotes !== '';
	fs.task = isTaskMarker(p.marker);
	fs.bullet = isBulletMarker(p.marker);
	fs.ordered = isOrderedMarker(p.marker);
	fs.heading = p.heading.trim().length;
	return fs;
}

/* ==========================================================================
   Extension assembly
   ========================================================================== */

/** Editor chrome: quiet, paper-like, centered 760px writing column. */
const editorTheme = EditorView.theme({
	'&': {
		height: '100%',
		fontSize: '14.5px',
		backgroundColor: 'transparent',
		color: 'var(--fg)'
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		fontFamily: 'var(--font-mono)',
		lineHeight: '1.85',
		overflowX: 'hidden'
	},
	'.cm-content': {
		maxWidth: '764px',
		margin: '0 auto',
		padding: '34px 52px 45vh',
		caretColor: 'var(--accent)'
	},
	'.cm-line': { padding: '0 2px' },
	'.cm-cursor, .cm-dropCursor': {
		borderLeftColor: 'var(--accent)',
		borderLeftWidth: '2px'
	},
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
		{
			background: 'color-mix(in srgb, var(--accent) 16%, transparent) !important'
		},
	'.cm-selectionMatch': {
		background: 'color-mix(in srgb, var(--fg) 9%, transparent)',
		borderRadius: '2px'
	},
	'.cm-searchMatch': {
		background: 'color-mix(in srgb, var(--saffron) 22%, transparent)',
		borderRadius: '2px',
		outline: '1px solid color-mix(in srgb, var(--saffron) 40%, transparent)'
	},
	'.cm-searchMatch.cm-searchMatch-selected': {
		background: 'color-mix(in srgb, var(--saffron) 45%, transparent)'
	},
	'.cm-placeholder': { color: 'var(--muted-2)' }
});

/** Markdown source highlighting — editorial: structure pops, marks recede.
 *  H1/H2 borrow the reader's Fraunces display voice so the live view feels
 *  like the document, not a code buffer. */
const mdHighlight = HighlightStyle.define([
	{
		tag: tags.heading1,
		fontFamily: 'var(--font-display)',
		fontSize: '1.9em',
		fontWeight: '550',
		letterSpacing: '-0.02em',
		lineHeight: '1.25'
	},
	{
		tag: tags.heading2,
		fontFamily: 'var(--font-display)',
		fontSize: '1.5em',
		fontWeight: '560',
		letterSpacing: '-0.015em',
		lineHeight: '1.3'
	},
	{ tag: tags.heading3, fontSize: '1.15em', fontWeight: '650', lineHeight: '1.3' },
	{ tag: tags.heading4, fontWeight: '650' },
	{ tag: tags.heading5, fontWeight: '650' },
	{ tag: tags.heading6, fontWeight: '650', color: 'var(--fg-2)' },
	{ tag: tags.strong, fontWeight: '680' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{ tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
	{ tag: tags.link, color: 'var(--accent)' },
	{ tag: tags.url, color: 'var(--muted)', textDecoration: 'underline' },
	{ tag: tags.labelName, color: 'var(--accent)' },
	{ tag: tags.quote, color: 'var(--fg-2)', fontStyle: 'italic' },
	{ tag: tags.processingInstruction, color: 'var(--muted-2)' },
	{ tag: tags.meta, color: 'var(--muted-2)' },
	{ tag: tags.atom, color: 'var(--accent)' },
	{ tag: tags.contentSeparator, color: 'var(--muted-2)', fontWeight: '700' },
	// Nested fenced-code tokens (via codeLanguages) reuse the reading palette.
	{ tag: tags.keyword, color: 'var(--code-kw)' },
	{ tag: tags.string, color: 'var(--code-str)' },
	{ tag: tags.number, color: 'var(--code-num)' },
	{
		tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
		color: 'var(--code-fn)'
	},
	{ tag: tags.typeName, color: 'var(--code-type)' },
	{ tag: tags.comment, color: 'var(--code-com)', fontStyle: 'italic' },
	{ tag: tags.propertyName, color: 'var(--code-attr)' },
	{ tag: [tags.bool, tags.null], color: 'var(--code-num)' }
]);

/* ==========================================================================
   Comment anchors — saffron highlights over the markdown source, resolved
   with the same quote-matching fallbacks as the rendered view.
   ========================================================================== */

export type CommentAnchorSpec = { id: string } & Anchor;

/** Dispatch this effect after the comment set changes so highlights rebuild. */
export const refreshCommentsEffect = StateEffect.define<null>();

export function commentHighlights(opts: {
	getAnchors: () => CommentAnchorSpec[];
	onOrphans?: (ids: Set<string>) => void;
	onSelect?: (id: string) => void;
}): Extension {
	function build(state: EditorState): DecorationSet {
		const text = state.doc.toString();
		const ranges: Range<Decoration>[] = [];
		const orphans = new Set<string>();
		for (const a of opts.getAnchors()) {
			const hit = locateAnchorInText(text, a);
			if (hit && hit.end > hit.start) {
				ranges.push(
					Decoration.mark({
						class: 'cm-comment-anchor',
						attributes: { 'data-comment-id': a.id }
					}).range(hit.start, hit.end)
				);
			} else {
				orphans.add(a.id);
			}
		}
		opts.onOrphans?.(orphans);
		return Decoration.set(ranges, true);
	}

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view.state);
			}
			update(u: ViewUpdate) {
				const refreshed = u.transactions.some((tr) =>
					tr.effects.some((e) => e.is(refreshCommentsEffect))
				);
				if (u.docChanged || refreshed) {
					this.decorations = build(u.state);
				}
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				mousedown(event) {
					const t = event.target;
					if (t instanceof Element) {
						const mark = t.closest('.cm-comment-anchor');
						if (mark instanceof HTMLElement && mark.dataset.commentId) {
							opts.onSelect?.(mark.dataset.commentId);
						}
					}
					return false; // never swallow — the click still places the cursor
				}
			}
		}
	);
}

/* ==========================================================================
   Pending-comment highlight — keeps the target text visibly marked while
   the composer is open (the native selection stops painting once focus
   moves into the comment textarea).
   ========================================================================== */

export const setPendingComment = StateEffect.define<{ from: number; to: number } | null>();

export const pendingCommentField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(setPendingComment)) {
				deco = e.value
					? Decoration.set([
							Decoration.mark({ class: 'cm-comment-pending' }).range(e.value.from, e.value.to)
						])
					: Decoration.none;
			}
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});

/* ==========================================================================
   Outline over raw markdown source (h1-h3, fenced code skipped).
   ========================================================================== */

export type SourceOutlineItem = {
	level: number;
	text: string;
	/** Doc offset of the heading line start. */
	from: number;
};

export function outlineFromSource(source: string): SourceOutlineItem[] {
	const items: SourceOutlineItem[] = [];
	const lines = source.split('\n');
	let inFence = false;
	let fenceMark = '';
	let pos = 0;
	for (const line of lines) {
		const fence = line.match(/^\s*(```|~~~)/);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceMark = fence[1];
			} else if (fence[1] === fenceMark) {
				inFence = false;
			}
		} else if (!inFence) {
			const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
			if (m) {
				const text = m[2].replace(/[*_~`[\]]/g, '').trim();
				if (text) {
					items.push({ level: m[1].length, text, from: pos });
				}
			}
		}
		pos += line.length + 1;
	}
	return items;
}

export type EditorCallbacks = {
	/** Fired on every document change with the full new source. */
	onChange: (source: string) => void;
	/** Fired on doc/selection/history changes — drive toolbar + status bar. */
	onViewUpdate: (view: EditorView) => void;
	/** Cmd/Ctrl+S. */
	onSave?: () => void;
	/** Cmd/Ctrl+Alt+M — comment on the current selection (Google Docs). */
	onComment?: () => void;
};

export function buildExtensions(cb: EditorCallbacks, placeholderText: string): Extension[] {
	const formattingKeys = Prec.high(
		keymap.of([
			{ key: 'Mod-b', run: toggleBold },
			{ key: 'Mod-i', run: toggleItalic },
			{ key: 'Mod-e', run: toggleInlineCode },
			{ key: 'Mod-Shift-x', run: toggleStrike },
			{ key: 'Mod-k', run: insertLink },
			{ key: 'Mod-Shift-7', run: toggleList('ordered') },
			{ key: 'Mod-Shift-8', run: toggleList('bullet') },
			{ key: 'Mod-Shift-9', run: toggleList('task') },
			{ key: 'Mod-Shift-.', run: toggleQuote },
			{ key: 'Mod-Alt-1', run: setHeading(1) },
			{ key: 'Mod-Alt-2', run: setHeading(2) },
			{ key: 'Mod-Alt-3', run: setHeading(3) },
			{ key: 'Mod-Alt-0', run: setHeading(0) },
			{
				key: 'Mod-s',
				run: () => {
					cb.onSave?.();
					return true;
				}
			},
			{
				key: 'Mod-Alt-m',
				run: () => {
					cb.onComment?.();
					return true;
				}
			}
		])
	);

	// Smart paste: pasting a URL over a text selection creates a link.
	const smartPaste = EditorView.domEventHandlers({
		paste(event, view) {
			const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
			const range = view.state.selection.main;
			if (!text || range.empty || !URL_RE.test(text)) {
				return false;
			}
			const sel = view.state.sliceDoc(range.from, range.to);
			if (URL_RE.test(sel.trim())) {
				return false;
			}
			event.preventDefault();
			const insert = `[${sel}](${text})`;
			view.dispatch({
				changes: { from: range.from, to: range.to, insert },
				selection: EditorSelection.cursor(range.from + insert.length),
				userEvent: 'input.paste'
			});
			return true;
		}
	});

	return [
		history(),
		drawSelection(),
		dropCursor(),
		EditorState.allowMultipleSelections.of(true),
		closeBrackets(),
		highlightSelectionMatches(),
		search({ top: true }),
		formattingKeys,
		smartPaste,
		keymap.of([
			...closeBracketsKeymap,
			...defaultKeymap,
			...searchKeymap,
			...historyKeymap,
			indentWithTab
		]),
		markdown({ base: markdownLanguage, codeLanguages: languages }),
		syntaxHighlighting(mdHighlight),
		pendingCommentField,
		EditorView.lineWrapping,
		cmPlaceholder(placeholderText),
		// Spellcheck off: technical docs are dense with identifiers and paths,
		// and the browser's red squiggles turn the live view into noise.
		EditorView.contentAttributes.of({
			spellcheck: 'false',
			autocorrect: 'off',
			autocapitalize: 'off',
			'aria-label': 'Markdown source'
		}),
		editorTheme,
		EditorView.updateListener.of((u) => {
			if (u.docChanged) {
				cb.onChange(u.state.doc.toString());
			}
			if (u.docChanged || u.selectionSet || u.focusChanged) {
				cb.onViewUpdate(u.view);
			}
		})
	];
}
