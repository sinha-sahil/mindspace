import { marked } from 'marked';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';
import { browser } from '$app/environment';

const ANCHOR_CONTEXT = 32;

marked.setOptions({
	gfm: true,
	breaks: true
});

// GitHub-style callouts (> [!NOTE] …) and footnotes ([^1]).
marked.use(markedAlert());
marked.use(markedFootnote());

/**
 * GitHub-compatible heading slugs so rendered headings carry stable `id`s —
 * the document outline and hover-anchors hang off these. Duplicate slugs get
 * `-1`, `-2`… suffixes; the counter map resets on every renderMarkdown call.
 */
const slugCounts = new Map<string, number>();

function slugify(raw: string): string {
	const base = raw
		.toLowerCase()
		.trim()
		// Strip inline-markdown noise so "**Bold** title" and "Bold title" agree.
		.replace(/[`*_~[\]()]/g, '')
		.replace(/<[^>]*>/g, '')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/\s+/g, '-');
	const n = slugCounts.get(base) ?? 0;
	slugCounts.set(base, n + 1);
	return n === 0 ? base : `${base}-${n}`;
}

marked.use({
	renderer: {
		heading({ tokens, depth, text }) {
			const inline = this.parser.parseInline(tokens);
			return `<h${depth} id="${slugify(text)}">${inline}</h${depth}>\n`;
		}
	}
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
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
	slugCounts.clear();
	const html = marked.parse(source, { async: false });
	if (typeof html !== 'string') {
		return '';
	}
	// `pre.mermaid-diagram` placeholders survive sanitization (DOMPurify keeps
	// `pre` + `class` + text content); they're upgraded to SVG client-side.
	return DOMPurify.sanitize(html);
}

/** Render a single line of inline markdown (bold, code, links…) to sanitized
 *  HTML — used by the live editor's table widget for cell contents. */
export function renderInlineMarkdown(source: string): string {
	if (!DOMPurify) {
		return '';
	}
	const html = marked.parseInline(source, { async: false });
	if (typeof html !== 'string') {
		return '';
	}
	return DOMPurify.sanitize(html);
}

/**
 * Mermaid is heavy (~1MB) and browser-only, so it's lazy-loaded the first time
 * a diagram actually needs rendering and cached thereafter. `null` until then.
 */
let mermaid: (typeof import('mermaid'))['default'] | null = null;
let mermaidTheme: 'dark' | 'default' | null = null;
let diagramSeq = 0;

/** Rendered-SVG cache keyed by `theme::source`. Makes the editor's live
 *  preview flicker-free: unchanged diagrams re-attach instantly instead of
 *  going through a full async mermaid render on every keystroke. */
const mermaidCache = new Map<string, string>();
const MERMAID_CACHE_MAX = 60;

function cacheMermaid(key: string, svg: string) {
	if (mermaidCache.size >= MERMAID_CACHE_MAX) {
		const oldest = mermaidCache.keys().next().value ?? null;
		if (oldest !== null) {
			mermaidCache.delete(oldest);
		}
	}
	mermaidCache.set(key, svg);
}

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

	// Serve cache hits synchronously (no mermaid import needed) so unchanged
	// diagrams in a re-rendered preview never flash.
	const misses: HTMLElement[] = [];
	for (const node of nodes) {
		const src = node.textContent ?? '';
		const cached = mermaidCache.get(`${theme}::${src}`);
		if (cached) {
			node.setAttribute('data-processed', 'true');
			upgradeDiagramNode(node, cached);
		} else {
			misses.push(node);
		}
	}
	if (misses.length === 0) {
		return;
	}

	if (!mermaid || mermaidTheme !== theme) {
		const mod = await import('mermaid');
		mermaid = mod.default;
		// `securityLevel: 'strict'` makes Mermaid sanitize diagram labels and
		// strip any embedded HTML/scripts — the rendered SVG bypasses our
		// DOMPurify pass, so Mermaid must do its own sanitization.
		mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
		mermaidTheme = theme;
	}

	for (const node of misses) {
		const src = node.textContent ?? '';
		// Mark first so a thrown render never leaves a node to be retried forever.
		node.setAttribute('data-processed', 'true');
		try {
			const { svg } = await mermaid.render(`mermaid-${diagramSeq++}`, src);
			cacheMermaid(`${theme}::${src}`, svg);
			upgradeDiagramNode(node, svg);
		} catch (err) {
			node.classList.add('mermaid-error');
			node.textContent =
				err instanceof Error ? `Diagram error: ${err.message}` : 'Failed to render diagram.';
		}
	}
}

/** Swap a placeholder's source text for the rendered SVG + fullscreen button.
 *  Built in plain DOM since this runs after sanitization; the fullscreen UI
 *  (MermaidFullscreen.svelte) listens for clicks on the button class. */
function upgradeDiagramNode(node: HTMLElement, svg: string) {
	node.innerHTML = svg;
	node.classList.add('mermaid-rendered');
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = MERMAID_FULLSCREEN_BTN_CLASS;
	btn.setAttribute('aria-label', 'View diagram fullscreen');
	btn.title = 'View fullscreen';
	btn.innerHTML = MAXIMIZE_ICON;
	node.appendChild(btn);
}

/* ==========================================================================
   Post-render enhancement — everything that upgrades the sanitized HTML into
   the interactive reading experience: syntax highlighting, code copy buttons,
   heading anchors, live task checkboxes, wrapped tables, zoomable images.
   ========================================================================== */

/** Lucide "copy" and "check" glyphs for the injected code-copy button. */
const COPY_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/** highlight.js is lazy-loaded (like mermaid) the first time a code block
 *  needs coloring. The "common" build covers ~35 mainstream languages. */
let hljs: (typeof import('highlight.js/lib/common'))['default'] | null = null;

async function highlightCodeIn(container: HTMLElement): Promise<void> {
	const blocks = Array.from(
		container.querySelectorAll<HTMLElement>('pre > code[class*="language-"]:not([data-hl])')
	);
	if (blocks.length === 0) {
		return;
	}
	if (!hljs) {
		const mod = await import('highlight.js/lib/common');
		hljs = mod.default;
	}
	for (const block of blocks) {
		block.setAttribute('data-hl', 'true');
		// A comment highlight inside this block would be wiped by the innerHTML
		// swap — the anchored comment wins over syntax colors.
		if (block.querySelector('.comment-mark')) {
			continue;
		}
		const lang = (block.className.match(/language-([\w#+-]+)/)?.[1] ?? '').toLowerCase();
		if (!lang || !hljs.getLanguage(lang)) {
			continue;
		}
		try {
			// hljs output is trusted-by-construction: it HTML-escapes the code and
			// only injects its own <span class="hljs-…"> wrappers.
			block.innerHTML = hljs.highlight(block.textContent ?? '', {
				language: lang,
				ignoreIllegals: true
			}).value;
		} catch {
			// Leave the block as plain escaped text.
		}
	}
}

export type EnhanceOptions = {
	/** Enable task checkboxes; called with the task's document-order index. */
	onTaskToggle?: (taskIndex: number, checked: boolean) => void;
	/** Enable click-to-zoom on images. */
	onImageZoom?: (src: string, alt: string) => void;
};

/**
 * Upgrade a container that just received `renderMarkdown` output. Sync work
 * (anchors, copy buttons, tables, links, tasks) happens immediately; syntax
 * highlighting and mermaid rendering are kicked off async. Safe to call once
 * per rendered container (the {#key}/remount patterns guarantee that).
 */
export function enhanceRendered(container: HTMLElement, opts: EnhanceOptions = {}): void {
	// Heading anchors — quiet # links for h1-h4 that already carry slugs. The
	// glyph is a CSS ::before so it never enters textContent: comment anchors
	// are plain-text offsets over this container and must not shift.
	// (All steps are idempotent — some hosts re-run this on the same DOM.)
	for (const h of container.querySelectorAll('h1[id], h2[id], h3[id], h4[id]')) {
		if (h.querySelector(':scope > .h-anchor')) {
			continue;
		}
		const a = document.createElement('a');
		a.className = 'h-anchor';
		a.href = `#${h.id}`;
		a.setAttribute('aria-label', 'Link to this section');
		h.prepend(a);
	}

	// Tables → horizontal-scroll wrappers with rounded chrome.
	for (const table of container.querySelectorAll(':scope table')) {
		if (table.parentElement?.classList.contains('table-wrap')) {
			continue;
		}
		const wrap = document.createElement('div');
		wrap.className = 'table-wrap';
		table.before(wrap);
		wrap.appendChild(table);
	}

	// External links open in a new tab.
	for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
		if (a.classList.contains('h-anchor')) {
			continue;
		}
		const href = a.getAttribute('href') ?? '';
		if (/^https?:\/\//i.test(href)) {
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
		}
	}

	// Task-list checkboxes — style hooks always; interactivity only when the
	// caller can write the toggle back to the markdown source.
	const taskInputs = container.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]');
	taskInputs.forEach((input, index) => {
		const li = input.closest('li');
		if (!li) {
			return;
		}
		li.classList.add('task-item');
		li.classList.toggle('task-done', input.checked);
		if (opts.onTaskToggle && !input.dataset.taskBound) {
			input.dataset.taskBound = 'true';
			input.disabled = false;
			input.addEventListener('change', () => {
				li.classList.toggle('task-done', input.checked);
				opts.onTaskToggle?.(index, input.checked);
			});
		}
	});

	// Code blocks: language chip + copy button (skip mermaid placeholders).
	for (const pre of container.querySelectorAll<HTMLElement>('pre:not(.mermaid-diagram)')) {
		const code = pre.querySelector('code');
		if (!code || pre.querySelector(':scope > .code-copy')) {
			continue;
		}
		const lang = code.className.match(/language-([\w#+-]+)/)?.[1];
		if (lang) {
			// Label carried in a data attribute + CSS ::before so it stays out of
			// textContent (see the comment-anchor note above).
			const chip = document.createElement('span');
			chip.className = 'code-lang';
			chip.dataset.lang = lang;
			pre.appendChild(chip);
		}
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'code-copy';
		btn.title = 'Copy code';
		btn.setAttribute('aria-label', 'Copy code');
		btn.innerHTML = COPY_ICON;
		btn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(code.textContent ?? '');
				btn.innerHTML = CHECK_ICON;
				btn.classList.add('copied');
				setTimeout(() => {
					btn.innerHTML = COPY_ICON;
					btn.classList.remove('copied');
				}, 1400);
			} catch {
				// Clipboard unavailable (permissions/insecure context) — no-op.
			}
		});
		pre.appendChild(btn);
	}

	// Images: lazy-load; click-to-zoom when a handler is provided.
	for (const img of container.querySelectorAll<HTMLImageElement>('img')) {
		img.loading = 'lazy';
		if (opts.onImageZoom && !img.dataset.zoomable) {
			img.dataset.zoomable = 'true';
			img.addEventListener('click', () => {
				opts.onImageZoom?.(img.currentSrc || img.src, img.alt);
			});
		}
	}

	// Async upgrades — fire and forget.
	void highlightCodeIn(container);
	void renderMermaidDiagrams(container);
}

/** One outline entry per h1-h3 in the rendered document. */
export type OutlineItem = {
	id: string;
	text: string;
	level: number;
};

/** Extract the document outline from a rendered container. */
export function outlineFrom(container: HTMLElement): OutlineItem[] {
	const items: OutlineItem[] = [];
	for (const h of container.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')) {
		// Skip generated section headings (e.g. marked-footnote's "Footnotes").
		if (h.closest('.footnotes')) {
			continue;
		}
		const text = (h.textContent ?? '').replace(/^#\s*/, '').trim();
		if (!text) {
			continue;
		}
		items.push({ id: h.id, text, level: Number(h.tagName[1]) });
	}
	return items;
}

/**
 * Toggle the Nth task checkbox in markdown `source` (N = document-order index
 * among rendered checkboxes). Lines inside fenced code blocks are skipped so
 * the DOM index and the source scan stay aligned. Returns the new source, or
 * null when the index can't be located (source drifted — caller should no-op).
 */
export function toggleTaskInSource(
	source: string,
	taskIndex: number,
	checked: boolean
): string | null {
	const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
	const FENCE_RE = /^\s*(```|~~~)/;
	const lines = source.split('\n');
	let inFence = false;
	let fenceMark = '';
	let seen = -1;
	for (let i = 0; i < lines.length; i++) {
		const fence = lines[i].match(FENCE_RE);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceMark = fence[1];
			} else if (fence[1] === fenceMark) {
				inFence = false;
			}
			continue;
		}
		if (inFence || !TASK_RE.test(lines[i])) {
			continue;
		}
		seen++;
		if (seen === taskIndex) {
			lines[i] = lines[i].replace(TASK_RE, `$1${checked ? 'x' : ' '}$3`);
			return lines.join('\n');
		}
	}
	return null;
}

/** Word count over the raw markdown source (code and prose alike). */
export function countWords(source: string): number {
	return (source.match(/[\p{L}\p{N}][\p{L}\p{N}'’‑-]*/gu) ?? []).length;
}

/** Estimated reading time in whole minutes (~220 wpm), minimum 1. */
export function readingTimeMinutes(words: number): number {
	return Math.max(1, Math.round(words / 220));
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
	const located = locateAnchorInText(container.textContent ?? '', anchor);
	if (!located) {
		return null;
	}
	return rangeFromOffsets(container, located.start, located.end);
}

/**
 * The pure-text half of anchor resolution — find the anchor's quote inside
 * `text` (which may be rendered plain text OR raw markdown source; the
 * fallbacks tolerate whitespace drift either way). Used by rangeFromAnchor
 * for the DOM path and by the live editor to place comment highlights over
 * the markdown source.
 */
export function locateAnchorInText(
	text: string,
	anchor: Anchor
): { start: number; end: number } | null {
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

	return { start, end };
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
		// SHOW_TEXT walkers only yield Text nodes; instanceof narrows without
		// an assertion (which the lint config bans).
		if (n instanceof Text && range.intersectsNode(n)) {
			const start = n === range.startContainer ? range.startOffset : 0;
			const end = n === range.endContainer ? range.endOffset : n.length;
			// Skip zero-length touches at a boundary (intersectsNode is inclusive).
			if (end > start) {
				segments.push({ node: n, start, end });
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
