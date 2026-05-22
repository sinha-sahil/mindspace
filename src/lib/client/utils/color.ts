/**
 * Pick a stable color from a curated palette based on an arbitrary string key.
 * Used to give workspaces and projects an organic visual identity.
 */

export const PROJECT_PALETTE = [
	{ name: 'violet', from: '#a78bfa', to: '#7c3aed' },
	{ name: 'rose', from: '#f472b6', to: '#db2777' },
	{ name: 'amber', from: '#fbbf24', to: '#d97706' },
	{ name: 'sage', from: '#34d399', to: '#059669' },
	{ name: 'sky', from: '#60a5fa', to: '#2563eb' },
	{ name: 'tangerine', from: '#fb923c', to: '#ea580c' },
	{ name: 'cyan', from: '#22d3ee', to: '#0891b2' },
	{ name: 'fuchsia', from: '#e879f9', to: '#a21caf' },
	{ name: 'lime', from: '#a3e635', to: '#65a30d' },
	{ name: 'coral', from: '#f87171', to: '#dc2626' }
];

export function colorForKey(key: string): { from: string; to: string; name: string } {
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff;
	}
	const idx = Math.abs(hash) % PROJECT_PALETTE.length;
	return PROJECT_PALETTE[idx];
}

export function initialFor(name: string): string {
	const ch = name.trim()[0] ?? '?';
	return ch.toUpperCase();
}
