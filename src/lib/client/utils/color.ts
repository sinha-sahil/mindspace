/**
 * Stable per-key colors. Two palettes, two jobs (docs/design.md):
 *
 * - TINT_PALETTE — muted, desaturated identity tints for project tiles
 *   (Linear-style): enough hue to tell 25 projects apart at a glance,
 *   quiet enough to sit inside an achromatic shell. Consumed via
 *   `--tint` + color-mix so one mid-lightness value works in both modes.
 * - CURSOR_PALETTE — saturated presence colors for multiplayer cursors,
 *   where vividness IS the point.
 *
 * House rule: no purples, no pinks — in either palette.
 */

export const TINT_PALETTE = [
	{ name: 'stone', hex: '#8f8578' },
	{ name: 'rust', hex: '#a26a4f' },
	{ name: 'amber', hex: '#a8862e' },
	{ name: 'olive', hex: '#7f8f45' },
	{ name: 'sage', hex: '#4f8f68' },
	{ name: 'teal', hex: '#3f8f88' },
	{ name: 'sky', hex: '#5688b0' },
	{ name: 'slate', hex: '#74829c' }
];

/** Muted identity tint for a stable key (project id). */
export function tintForKey(key: string): { name: string; hex: string } {
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
	}
	return TINT_PALETTE[Math.abs(hash) % TINT_PALETTE.length];
}

export const CURSOR_PALETTE = [
	{ name: 'amber', from: '#fbbf24', to: '#d97706' },
	{ name: 'sage', from: '#34d399', to: '#059669' },
	{ name: 'sky', from: '#60a5fa', to: '#2563eb' },
	{ name: 'tangerine', from: '#fb923c', to: '#ea580c' },
	{ name: 'cyan', from: '#22d3ee', to: '#0891b2' },
	{ name: 'lime', from: '#a3e635', to: '#65a30d' },
	{ name: 'coral', from: '#f87171', to: '#dc2626' },
	{ name: 'teal', from: '#2dd4bf', to: '#0d9488' }
];

export function colorForKey(key: string): { from: string; to: string; name: string } {
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
	}
	const idx = Math.abs(hash) % CURSOR_PALETTE.length;
	return CURSOR_PALETTE[idx];
}

export function initialFor(name: string): string {
	const ch = name.trim()[0] ?? '?';
	return ch.toUpperCase();
}
