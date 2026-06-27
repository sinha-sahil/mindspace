/**
 * Shared cell → CSS translation, used by both the editable grid and the
 * read-only viewer so formatting renders identically. Returns format-only CSS
 * (no width/height); each view prepends its own sizing.
 */
import type { CellFormat, Border } from './model';

const FONT_STACKS: Record<string, string> = {
	'Sans Serif': 'system-ui, -apple-system, "Segoe UI", sans-serif',
	Serif: 'Georgia, "Times New Roman", serif',
	Monospace: 'var(--font-mono, ui-monospace), monospace',
	Geist: 'var(--font-sans, system-ui)',
	Inter: 'Inter, system-ui, sans-serif',
	Georgia: 'Georgia, serif',
	'Times New Roman': '"Times New Roman", Times, serif',
	'Courier New': '"Courier New", monospace',
	Arial: 'Arial, Helvetica, sans-serif'
};

export function fontStack(name: string): string {
	return FONT_STACKS[name] ?? name;
}

export function borderCss(b: Border): string {
	const width =
		b.style === 'medium'
			? '2px'
			: b.style === 'thick'
				? '3px'
				: b.style === 'double'
					? '3px'
					: '1px';
	const line =
		b.style === 'dashed'
			? 'dashed'
			: b.style === 'dotted'
				? 'dotted'
				: b.style === 'double'
					? 'double'
					: 'solid';
	return `${width} ${line} ${b.color}`;
}

/** Format-only inline CSS for a cell (everything except width/height). */
export function formatCss(f: CellFormat | null): string {
	if (!f) {
		return '';
	}
	let s = '';
	if (f.bold) {
		s += 'font-weight:600;';
	}
	if (f.italic) {
		s += 'font-style:italic;';
	}
	if (f.underline || f.strike) {
		const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : '']
			.filter(Boolean)
			.join(' ');
		s += `text-decoration:${deco};`;
	}
	if (f.align) {
		const jc = f.align === 'center' ? 'center' : f.align === 'right' ? 'flex-end' : 'flex-start';
		s += `text-align:${f.align};justify-content:${jc};`;
	}
	if (f.valign) {
		const ai = f.valign === 'top' ? 'flex-start' : f.valign === 'bottom' ? 'flex-end' : 'center';
		s += `align-items:${ai};`;
	}
	if (f.color) {
		s += `color:${f.color};`;
	}
	if (f.bg) {
		s += `background:${f.bg};`;
	}
	if (f.font && f.font !== 'Default') {
		s += `font-family:${fontStack(f.font)};`;
	}
	if (f.size) {
		s += `font-size:${f.size}px;`;
	}
	if (f.indent) {
		s += `padding-left:${f.indent * 12 + 5}px;`;
	}
	if (f.wrap) {
		s += 'white-space:normal;';
	}
	if (f.borders) {
		if (f.borders.top) {
			s += `border-top:${borderCss(f.borders.top)};`;
		}
		if (f.borders.right) {
			s += `border-right:${borderCss(f.borders.right)};`;
		}
		if (f.borders.bottom) {
			s += `border-bottom:${borderCss(f.borders.bottom)};`;
		}
		if (f.borders.left) {
			s += `border-left:${borderCss(f.borders.left)};`;
		}
	}
	return s;
}
