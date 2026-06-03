import { browser } from '$app/environment';

export type ThemeMode = 'light' | 'dark' | 'system';

/** A visual identity ("skin") — orthogonal to light/dark mode. The default
 *  `editorial-luxe` is the bare :root in theme.css; the others set `data-skin`. */
export type ThemeSkin = 'editorial-luxe' | 'lumen' | 'voltaic' | 'terracotta';

export const SKINS: { id: ThemeSkin; label: string; blurb: string }[] = [
	{ id: 'editorial-luxe', label: 'Editorial Luxe', blurb: 'Quiet luxury · Fraunces Didone' },
	{ id: 'lumen', label: 'Lumen', blurb: 'Luminous spatial glass · electric indigo' },
	{ id: 'voltaic', label: 'Voltaic', blurb: 'Electric precision · graphite + azure' },
	{ id: 'terracotta', label: 'Terracotta', blurb: 'Earthy & tactile · moss green' }
];

const MODE_KEY = 'mindspace::theme';
const SKIN_KEY = 'mindspace::skin';
const DEFAULT_SKIN: ThemeSkin = 'editorial-luxe';

function readInitialMode(): ThemeMode {
	if (!browser) {
		return 'system';
	}
	const v = localStorage.getItem(MODE_KEY);
	if (v === 'light' || v === 'dark' || v === 'system') {
		return v;
	}
	return 'system';
}

function readInitialSkin(): ThemeSkin {
	if (!browser) {
		return DEFAULT_SKIN;
	}
	const v = localStorage.getItem(SKIN_KEY);
	if (v && SKINS.some((s) => s.id === v)) {
		return v as ThemeSkin;
	}
	return DEFAULT_SKIN;
}

function applyMode(mode: ThemeMode) {
	if (!browser) {
		return;
	}
	const html = document.documentElement;
	if (mode === 'system') {
		html.removeAttribute('data-theme');
	} else {
		html.setAttribute('data-theme', mode);
	}
}

function applySkin(skin: ThemeSkin) {
	if (!browser) {
		return;
	}
	const html = document.documentElement;
	// The default skin is the bare :root, so leave the attribute off for it.
	if (skin === DEFAULT_SKIN) {
		html.removeAttribute('data-skin');
	} else {
		html.setAttribute('data-skin', skin);
	}
}

function createTheme() {
	const state: { mode: ThemeMode; skin: ThemeSkin } = $state({
		mode: readInitialMode(),
		skin: readInitialSkin()
	});

	if (browser) {
		applyMode(state.mode);
		applySkin(state.skin);
	}

	function set(mode: ThemeMode) {
		state.mode = mode;
		if (browser) {
			localStorage.setItem(MODE_KEY, mode);
			applyMode(mode);
		}
	}

	function setSkin(skin: ThemeSkin) {
		state.skin = skin;
		if (browser) {
			localStorage.setItem(SKIN_KEY, skin);
			applySkin(skin);
		}
	}

	return {
		get mode() {
			return state.mode;
		},
		get skin() {
			return state.skin;
		},
		set,
		setSkin
	};
}

export const theme = createTheme();
