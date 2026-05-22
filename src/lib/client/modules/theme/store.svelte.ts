import { browser } from '$app/environment';

export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'mindspace::theme';

function readInitial(): ThemeMode {
	if (!browser) {return 'system';}
	const v = localStorage.getItem(STORAGE_KEY);
	if (v === 'light' || v === 'dark' || v === 'system') {return v;}
	return 'system';
}

function applyToDom(mode: ThemeMode) {
	if (!browser) {return;}
	const html = document.documentElement;
	if (mode === 'system') {html.removeAttribute('data-theme');}
	else {html.setAttribute('data-theme', mode);}
}

function createTheme() {
	const state: { mode: ThemeMode } = $state({ mode: readInitial() });

	if (browser) {
		applyToDom(state.mode);
	}

	function set(mode: ThemeMode) {
		state.mode = mode;
		if (browser) {
			localStorage.setItem(STORAGE_KEY, mode);
			applyToDom(mode);
		}
	}

	return {
		get mode() {
			return state.mode;
		},
		set
	};
}

export const theme = createTheme();
