/**
 * Design-drift ratchet (docs/design.md).
 *
 * Greps the component tree for the drift classes the July 2026 UI audit
 * quantified. Each metric has a checked-in baseline; counts may only go
 * DOWN. Lowering a count updates nothing automatically — edit the baseline
 * here when you intentionally burn debt down, and CI fails anyone who adds
 * new drift.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src/lib', 'src/routes'];
const EXTS = new Set(['.svelte', '.css', '.ts']);

// Counts may only decrease. Update deliberately when paying debt down.
const BASELINE = {
	rawHexOutsideTheme: 83,
	rawRadiusPx: 153,
	rawZIndex: 16,
	legacyAliasRefs: 0,
	purpleHexes: 0
};

const files = [];
function walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			walk(p);
		} else if (EXTS.has(p.slice(p.lastIndexOf('.')))) {
			files.push(p);
		}
	}
}
for (const root of ROOTS) {
	walk(root);
}

const isPurple = (hex) => {
	let h = hex.slice(1);
	if (h.length === 3) {
		h = [...h].map((c) => c + c).join('');
	}
	if (h.length !== 6) {
		return false;
	}
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === min) {
		return false;
	}
	const d = max - min;
	let hue;
	if (max === r) {
		hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
	} else if (max === g) {
		hue = ((b - r) / d + 2) * 60;
	} else {
		hue = ((r - g) / d + 4) * 60;
	}
	const sat = max === 0 ? 0 : d / max;
	return hue >= 255 && hue <= 335 && sat > 0.25;
};

const counts = {
	rawHexOutsideTheme: 0,
	rawRadiusPx: 0,
	rawZIndex: 0,
	legacyAliasRefs: 0,
	purpleHexes: 0
};
const purpleHits = [];

for (const file of files) {
	const rel = relative(process.cwd(), file);
	const text = readFileSync(file, 'utf8');
	// Sanctioned color sources — tokens and the curated identity/cursor palettes.
	const isTheme = rel.endsWith('theme.css') || rel.endsWith('utils/color.ts');

	for (const m of text.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g)) {
		if (!isTheme) {
			counts.rawHexOutsideTheme++;
		}
		if (isPurple(m[0])) {
			counts.purpleHexes++;
			purpleHits.push(`${rel}: ${m[0]}`);
		}
	}
	if (!isTheme) {
		for (const m of text.matchAll(/border-radius:\s*([^;]+);/g)) {
			const v = m[1].trim();
			if (/^\d/.test(v) && !v.startsWith('50%') && !/^[12]px$/.test(v)) {
				counts.rawRadiusPx++;
			}
		}
		for (const m of text.matchAll(/z-index:\s*([^;]+);/g)) {
			const v = m[1].trim();
			if (/^\d+$/.test(v) && Number(v) > 10) {
				counts.rawZIndex++;
			}
		}
	}
	counts.legacyAliasRefs += (text.match(/--(geist-[a-z-]+|accents-\d)/g) ?? []).length;
}

let failed = false;
for (const [key, value] of Object.entries(counts)) {
	const cap = BASELINE[key];
	const ok = value <= cap;
	if (!ok) {
		failed = true;
	}
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${key}: ${value} (baseline ${cap})`);
}
if (purpleHits.length > 0) {
	console.log('\npurple leaks:');
	for (const hit of purpleHits) {
		console.log('  ' + hit);
	}
}
if (failed) {
	console.error('\ndesign-lint: drift above baseline — see docs/design.md');
	process.exit(1);
}
