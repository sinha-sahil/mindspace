import { browser } from '$app/environment';

export type ThemeMode = 'light' | 'dark' | 'system';

/** The one chromatic choice in the Mono theme system. Everything else is
 *  achromatic; the accent recolors links, selection, focus, checked tasks and
 *  primary actions. `coral` is the bare :root default in theme.css; the
 *  others set `data-accent`. */
export type ThemeAccent = 'coral' | 'blue' | 'green';

export const ACCENTS: { id: ThemeAccent; label: string; light: string; dark: string }[] = [
	{ id: 'coral', label: 'Coral', light: '#c5443d', dark: '#d06e64' },
	{ id: 'blue', label: 'Blue', light: '#006dd8', dark: '#4c94e0' },
	{ id: 'green', label: 'Green', light: '#007f52', dark: '#4ea079' }
];

const MODE_KEY = 'mindspace::theme';
const ACCENT_KEY = 'mindspace::accent';
const DEFAULT_ACCENT: ThemeAccent = 'coral';

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

function readInitialAccent(): ThemeAccent {
	if (!browser) {
		return DEFAULT_ACCENT;
	}
	const v = localStorage.getItem(ACCENT_KEY);
	const found = v ? ACCENTS.find((a) => a.id === v) : null;
	if (found) {
		return found.id;
	}
	return DEFAULT_ACCENT;
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

function applyAccent(accent: ThemeAccent) {
	if (!browser) {
		return;
	}
	const html = document.documentElement;
	// The default accent is the bare :root, so leave the attribute off for it.
	if (accent === DEFAULT_ACCENT) {
		html.removeAttribute('data-accent');
	} else {
		html.setAttribute('data-accent', accent);
	}
	// The retired skin attribute must never linger from an old session.
	html.removeAttribute('data-skin');
}

function createTheme() {
	const state: { mode: ThemeMode; accent: ThemeAccent } = $state({
		mode: readInitialMode(),
		accent: readInitialAccent()
	});

	if (browser) {
		applyMode(state.mode);
		applyAccent(state.accent);
	}

	function set(mode: ThemeMode) {
		state.mode = mode;
		if (browser) {
			localStorage.setItem(MODE_KEY, mode);
			applyMode(mode);
		}
	}

	function setAccent(accent: ThemeAccent) {
		state.accent = accent;
		if (browser) {
			localStorage.setItem(ACCENT_KEY, accent);
			applyAccent(accent);
		}
	}

	return {
		get mode() {
			return state.mode;
		},
		get accent() {
			return state.accent;
		},
		set,
		setAccent
	};
}

export const theme = createTheme();
