/**
 * Stable per-key colors — used ONLY where hue carries meaning greys cannot:
 * multiplayer presence (peer cursors, live avatars). App chrome — project
 * tiles, workspace/user avatars — is achromatic by design; see docs/design.md.
 *
 * House rule: no purples, no pinks.
 */

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
