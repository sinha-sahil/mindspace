import { marked } from 'marked';
import { browser } from '$app/environment';

const ANCHOR_CONTEXT = 32;

marked.setOptions({
	gfm: true,
	breaks: true
});

/** CSS class marking a rendered placeholder that holds Mermaid source. */
const MERMAID_CLASS = 'mermaid-diagram';

/** Lucide "maximize" glyph — inlined because the diagram button is built in
 *  plain DOM (post-sanitization), not via the Svelte <Icon> component. */
const MAXIMIZE_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

/** Class on the per-diagram button that opens the fullscreen overlay. The
 *  fullscreen UI itself lives in MermaidFullscreen.svelte, which listens for
 *  clicks on this class. */
export const MERMAID_FULLSCREEN_BTN_CLASS = 'mermaid-fullscreen-btn';

/** Escape the characters that are unsafe inside HTML text content. The raw
 *  Mermaid source (which contains `<`, `>`, `&`, `-->`, etc.) is stored as the
 *  element's text content so DOMPurify keeps it intact; `renderMermaidDiagrams`
 *  later reads it back via `textContent`, which un-escapes these entities. */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

// Intercept fenced code blocks tagged `mermaid` and emit a placeholder that
// carries the diagram source as text. Everything else falls back to marked's
// default code renderer (return `false`). The actual SVG is rendered on the
// client, after sanitization, by `renderMermaidDiagrams`.
marked.use({
	renderer: {
		code(token) {
			const lang = (token.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
			if (lang === 'mermaid') {
				return `<pre class="${MERMAID_CLASS}">${escapeHtml(token.text)}</pre>`;
			}
			return false;
		}
	}
});

/**
 * DOMPurify is lazy-loaded in the browser only. Importing
 * `isomorphic-dompurify` at module top pulls jsdom into the SSR chunk,
 * and jsdom's optional `canvas` dep isn't available on Vercel's Node
 * runtime — it crashes the whole `/` page on first authenticated render.
 *
 * On the server we render nothing (return empty). The client hydrates,
 * loads DOMPurify via a top-level dynamic await, and renders + sanitizes
 * properly. The brief pre-hydration window shows a blank document area,
 * not unsanitized HTML, so there's no XSS gap.
 */
type DOMPurifyInstance = { sanitize: (html: string) => string };
let DOMPurify: DOMPurifyInstance | null = null;
if (browser) {
	const mod = await import('isomorphic-dompurify');
	DOMPurify = mod.default;
}

/** Render markdown source to sanitized HTML (browser-only — empty on SSR). */
export function renderMarkdown(source: string): string {
	if (!DOMPurify) {
		return '';
	}
	const html = marked.parse(source, { async: false });
	if (typeof html !== 'string') {
		return '';
	}
	// `pre.mermaid-diagram` placeholders survive sanitization (DOMPurify keeps
	// `pre` + `class` + text content); they're upgraded to SVG client-side.
	return DOMPurify.sanitize(html);
}

/**
 * Mermaid is heavy (~1MB) and browser-only, so it's lazy-loaded the first time
 * a diagram actually needs rendering and cached thereafter. `null` until then.
 */
type MermaidApi = {
	initialize: (config: Record<string, unknown>) => void;
	render: (id: string, src: string) => Promise<{ svg: string }>;
};
let mermaid: MermaidApi | null = null;
let mermaidTheme: 'dark' | 'default' | null = null;
let diagramSeq = 0;

/** Resolve the app's active theme to a Mermaid theme name. The app sets
 *  `data-theme` on <html>; absent means "follow system preference". */
function currentMermaidTheme(): 'dark' | 'default' {
	const attr = document.documentElement.getAttribute('data-theme');
	if (attr === 'dark') {
		return 'dark';
	}
	if (attr === 'light') {
		return 'default';
	}
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

/**
 * Find every un-rendered `pre.mermaid-diagram` placeholder in `container` and
 * replace its contents with the rendered SVG. Safe to call repeatedly: already
 * processed nodes carry `data-processed` and are skipped. Call after the
 * markdown is rendered (and re-call when the rendered DOM is rebuilt).
 *
 * Diagrams render independently — one diagram with a syntax error shows an
 * inline error message without blocking the others.
 */
export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
	const nodes = container.querySelectorAll<HTMLElement>(
		`pre.${MERMAID_CLASS}:not([data-processed])`
	);
	if (nodes.length === 0) {
		return;
	}

	const theme = currentMermaidTheme();
	if (!mermaid || mermaidTheme !== theme) {
		const mod = await import('mermaid');
		mermaid = mod.default as unknown as MermaidApi;
		// `securityLevel: 'strict'` makes Mermaid sanitize diagram labels and
		// strip any embedded HTML/scripts — the rendered SVG bypasses our
		// DOMPurify pass, so Mermaid must do its own sanitization.
		mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
		mermaidTheme = theme;
	}

	for (const node of nodes) {
		const src = node.textContent ?? '';
		// Mark first so a thrown render never leaves a node to be retried forever.
		node.setAttribute('data-processed', 'true');
		try {
			const { svg } = await mermaid.render(`mermaid-${diagramSeq++}`, src);
			node.innerHTML = svg;
			node.classList.add('mermaid-rendered');
			// Overlay a fullscreen trigger. Built in plain DOM since this runs
			// after sanitization; MermaidFullscreen.svelte handles the click.
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = MERMAID_FULLSCREEN_BTN_CLASS;
			btn.setAttribute('aria-label', 'View diagram fullscreen');
			btn.title = 'View fullscreen';
			btn.innerHTML = MAXIMIZE_ICON;
			node.appendChild(btn);
		} catch (err) {
			node.classList.add('mermaid-error');
			node.textContent =
				err instanceof Error ? `Diagram error: ${err.message}` : 'Failed to render diagram.';
		}
	}
}

/** A W3C-style text anchor: the quoted text plus disambiguating context. */
export type Anchor = {
	quote: string;
	prefix: string;
	suffix: string;
	start: number;
	end: number;
};

/**
 * Capture the current window selection inside `container` as an Anchor.
 * Returns null if there's no selection, it's collapsed, or it falls outside
 * the container.
 *
 * Uses the Range-comparison trick: a range from container[0] up to the
 * selection's start, stringified, gives the plain-text offset of the start.
 * Same for end. No tree-walking needed and no off-by-one with element nodes.
 */
export function anchorFromSelection(container: HTMLElement): Anchor | null {
	if (typeof window === 'undefined') {
		return null;
	}
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
		return null;
	}
	const range = sel.getRangeAt(0);
	if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
		return null;
	}
	const quote = sel.toString();
	if (!quote.trim()) {
		return null;
	}

	const text = container.textContent ?? '';
	const offsets = offsetsFromRange(container, range);
	if (!offsets) {
		return null;
	}
	const prefix = text.slice(Math.max(0, offsets.start - ANCHOR_CONTEXT), offsets.start);
	const suffix = text.slice(offsets.end, Math.min(text.length, offsets.end + ANCHOR_CONTEXT));

	return { quote, prefix, suffix, start: offsets.start, end: offsets.end };
}

function offsetsFromRange(
	container: HTMLElement,
	range: Range
): { start: number; end: number } | null {
	try {
		const preStart = document.createRange();
		preStart.setStart(container, 0);
		preStart.setEnd(range.startContainer, range.startOffset);
		const start = preStart.toString().length;

		const preEnd = document.createRange();
		preEnd.setStart(container, 0);
		preEnd.setEnd(range.endContainer, range.endOffset);
		const end = preEnd.toString().length;

		return { start, end };
	} catch {
		return null;
	}
}

/** Absolute floor on a partial-match length, regardless of quote size. */
const MIN_PARTIAL_MATCH_ABS = 24;
/** Fraction of the original quote that must survive trimming. 0.5 means
 *  "at most ~half of the quote can be missing" — enough to absorb a
 *  heading split or a small re-flow plus a few trimmed leading/trailing
 *  words, not enough to match a tiny tail elsewhere in the document. */
const MIN_PARTIAL_MATCH_RATIO = 0.5;
/** Maximum number of leading/trailing words we'll trim while searching. */
const MAX_PARTIAL_TRIM_WORDS = 4;

/**
 * Find a DOM Range in `container` that matches `anchor`. Tries, in order:
 *   1. The stored offsets — fast path when nothing has changed.
 *   2. prefix + quote + suffix — survives small shifts cleanly.
 *   3. quote alone (exact) — survives most edits within the same paragraph.
 *   4. quote with whitespace-tolerant search — survives structural changes
 *      like a heading splitting away ("Model Role" → "Model" heading then
 *      "Role" bullet, where the plain-text rendering now has newlines
 *      between them). Any run of whitespace in the original quote is
 *      allowed to match any run of whitespace in the current text.
 *   5. progressively trimmed quote (still whitespace-tolerant) — survives
 *      bigger structural edits. Trims up to MAX_PARTIAL_TRIM_WORDS leading
 *      then trailing words, requires the surviving portion be at least
 *      MIN_PARTIAL_MATCH_RATIO of the original length so we don't false-
 *      match a tiny tail in some unrelated paragraph.
 *
 * Returns null only when no usable substring of the quote can be found.
 */
export function rangeFromAnchor(container: HTMLElement, anchor: Anchor): Range | null {
	const text = container.textContent ?? '';
	if (!text) {
		return null;
	}

	let start = anchor.start;
	let end = anchor.end;

	if (text.slice(start, end) !== anchor.quote) {
		// 2. prefix + quote + suffix (exact).
		const fullPattern = anchor.prefix + anchor.quote + anchor.suffix;
		let idx = fullPattern ? text.indexOf(fullPattern) : -1;
		if (idx >= 0) {
			start = idx + anchor.prefix.length;
			end = start + anchor.quote.length;
		} else {
			// 3. quote alone (exact).
			idx = text.indexOf(anchor.quote);
			if (idx >= 0) {
				start = idx;
				end = idx + anchor.quote.length;
			} else {
				// 4. whitespace-tolerant full-quote search.
				const fuzzy = fuzzyWhitespaceSearch(text, anchor.quote);
				if (fuzzy) {
					start = fuzzy.start;
					end = fuzzy.end;
				} else {
					// 5. trim words from each end, still whitespace-tolerant.
					const partial = findPartialQuote(text, anchor.quote);
					if (!partial) {
						return null;
					}
					start = partial.start;
					end = partial.end;
				}
			}
		}
	}

	return rangeFromOffsets(container, start, end);
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Find `quote` in `text`, allowing any run of whitespace in the quote to
 * match any run of whitespace in the text (`\s+`). Other characters must
 * still match exactly. This handles the common drift where a markdown
 * edit changes "..." into a heading split or a paragraph break — the
 * words survive, only the whitespace between them changes.
 *
 * Returns the matched range in `text` (start..end), or null if no match.
 */
function fuzzyWhitespaceSearch(text: string, quote: string): { start: number; end: number } | null {
	const trimmed = quote.trim();
	if (!trimmed) {
		return null;
	}
	// Escape regex metacharacters, then collapse any whitespace span in
	// the quote into \s+ so it'll absorb newlines / extra spaces in text.
	const pattern = trimmed.replace(REGEX_META, '\\$&').replace(/\s+/g, '\\s+');
	let m: RegExpExecArray | null;
	try {
		m = new RegExp(pattern).exec(text);
	} catch {
		return null;
	}
	if (!m) {
		return null;
	}
	return { start: m.index, end: m.index + m[0].length };
}

/**
 * Try to find a substring of `quote` in `text` after trimming up to
 * MAX_PARTIAL_TRIM_WORDS leading then trailing words. Each candidate is
 * matched with whitespace tolerance (same logic as fuzzyWhitespaceSearch).
 * The surviving portion must be at least
 * `max(MIN_PARTIAL_MATCH_ABS, quote.length × MIN_PARTIAL_MATCH_RATIO)` chars
 * — otherwise we'd happily match a 47-char tail of a 300-char quote that
 * was actually mostly deleted, which is visually misleading. Better to
 * surface "Anchor lost" than highlight the wrong text.
 */
function findPartialQuote(text: string, quote: string): { start: number; end: number } | null {
	const minLen = Math.max(
		MIN_PARTIAL_MATCH_ABS,
		Math.floor(quote.length * MIN_PARTIAL_MATCH_RATIO)
	);
	if (quote.length < minLen) {
		return null;
	}

	// Trim leading words ("Model Role — ..." → "Role — ..." → ...).
	let q = quote;
	for (let i = 0; i < MAX_PARTIAL_TRIM_WORDS; i++) {
		const spaceIdx = q.indexOf(' ');
		if (spaceIdx < 0) {
			break;
		}
		q = q.slice(spaceIdx + 1);
		if (q.length < minLen) {
			break;
		}
		const hit = fuzzyWhitespaceSearch(text, q);
		if (hit) {
			return hit;
		}
	}

	// Trim trailing words.
	q = quote;
	for (let i = 0; i < MAX_PARTIAL_TRIM_WORDS; i++) {
		const spaceIdx = q.lastIndexOf(' ');
		if (spaceIdx < 0) {
			break;
		}
		q = q.slice(0, spaceIdx);
		if (q.length < minLen) {
			break;
		}
		const hit = fuzzyWhitespaceSearch(text, q);
		if (hit) {
			return hit;
		}
	}

	return null;
}

function rangeFromOffsets(container: HTMLElement, start: number, end: number): Range | null {
	const range = document.createRange();
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let offset = 0;
	let startSet = false;
	let node: Node | null = walker.nextNode();
	while (node) {
		const len = node.textContent?.length ?? 0;
		// `>` (strict) for start so that an offset sitting at a node boundary
		// resolves to the BEGINNING of the next text node — keeping the range
		// inside the same element as `end` so surroundContents can wrap it.
		// `>=` for end is symmetric: end-at-boundary means end of THIS node.
		if (!startSet && offset + len > start) {
			range.setStart(node, start - offset);
			startSet = true;
		}
		if (offset + len >= end) {
			range.setEnd(node, end - offset);
			return startSet ? range : null;
		}
		offset += len;
		node = walker.nextNode();
	}
	return null;
}

/**
 * Wrap every text-node slice the range covers with its own
 * <mark.comment-mark data-comment-id=...>. Returns true if at least one
 * slice was wrapped.
 *
 * We deliberately do NOT use `range.surroundContents()`: it throws
 * `InvalidStateError` the moment the range partially selects a non-Text
 * node — which is the *common* case in rendered markdown, where a normal
 * selection spans inline elements (`<strong>`, `<code>`, `<a>`) or a
 * sentence boundary. Instead we collect the in-range portion of each text
 * node and wrap them individually, so a highlight can straddle inline
 * formatting and even multiple paragraphs.
 */
function wrapRangeWithMark(range: Range, id: string): boolean {
	// Snapshot the in-range slice of every intersecting text node BEFORE
	// mutating the DOM — splitText below would otherwise invalidate the
	// offsets we still need for later nodes (and for a single node that
	// holds both range ends).
	const segments: Array<{ node: Text; start: number; end: number }> = [];
	// A TreeWalker only visits *descendants* of its root, so if the range
	// lives inside a single text node (commonAncestorContainer is that Text
	// node) we must root the walk at its parent — otherwise the walker yields
	// nothing and the highlight is wrongly dropped as an orphan.
	const ca = range.commonAncestorContainer;
	const root = ca.nodeType === Node.TEXT_NODE ? (ca.parentNode ?? ca) : ca;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let n: Node | null = walker.nextNode();
	while (n) {
		const t = n as Text;
		if (range.intersectsNode(t)) {
			const start = t === range.startContainer ? range.startOffset : 0;
			const end = t === range.endContainer ? range.endOffset : t.length;
			// Skip zero-length touches at a boundary (intersectsNode is inclusive).
			if (end > start) {
				segments.push({ node: t, start, end });
			}
		}
		n = walker.nextNode();
	}
	if (segments.length === 0) {
		return false;
	}

	for (const seg of segments) {
		let node = seg.node;
		let end = seg.end;
		// Trim the leading out-of-range part off the front.
		if (seg.start > 0) {
			node = node.splitText(seg.start);
			end -= seg.start;
		}
		// Trim the trailing out-of-range part off the back.
		if (end < node.length) {
			node.splitText(end);
		}
		const mark = document.createElement('mark');
		mark.className = 'comment-mark';
		mark.dataset.commentId = id;
		node.parentNode?.insertBefore(mark, node);
		mark.appendChild(node);
	}
	return true;
}

/**
 * Wrap each anchor's text range with <mark.comment-mark data-comment-id=...>.
 * Call after the markdown is rendered into `container`. Re-call on content
 * change.
 *
 * Returns the Set of comment ids whose anchor could not be located in the
 * rendered text — useful for surfacing an "anchor lost" indicator in the
 * sidebar so the author knows which threads no longer have a visual hook.
 */
export function applyHighlights(
	container: HTMLElement,
	anchors: Array<{ id: string } & Anchor>
): Set<string> {
	const orphans = new Set<string>();
	// Wrap from last to first so each splitText doesn't shift earlier offsets.
	const sorted = [...anchors].sort((a, b) => b.start - a.start);
	for (const a of sorted) {
		const range = rangeFromAnchor(container, a);
		if (!range || !wrapRangeWithMark(range, a.id)) {
			orphans.add(a.id);
		}
	}
	return orphans;
}
