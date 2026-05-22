import { browser } from '$app/environment';

const STORAGE_KEY = 'mindspace::sidebar-collapsed';

function readInitial(): boolean {
	if (!browser) {return false;}
	return localStorage.getItem(STORAGE_KEY) === '1';
}

function createSidebarStore() {
	const state = $state({ collapsed: readInitial() });

	function toggle() {
		state.collapsed = !state.collapsed;
		if (browser) {localStorage.setItem(STORAGE_KEY, state.collapsed ? '1' : '0');}
	}

	return {
		get collapsed() {
			return state.collapsed;
		},
		toggle
	};
}

export const sidebar = createSidebarStore();
