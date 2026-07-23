import { browser } from '$app/environment';

const STORAGE_KEY = 'mindspace::sidebar-collapsed';

function readInitial(): boolean {
	if (!browser) {
		return false;
	}
	return localStorage.getItem(STORAGE_KEY) === '1';
}

function createSidebarStore() {
	const state = $state({ collapsed: readInitial() });

	function toggle() {
		state.collapsed = !state.collapsed;
		if (browser) {
			localStorage.setItem(STORAGE_KEY, state.collapsed ? '1' : '0');
		}
	}

	/**
	 * Collapse without persisting — used when a width-hungry view (the doc
	 * editor) opens. The user's stored preference is untouched, so the rail
	 * comes back on the next app load, and the toggle still works to
	 * re-expand right away.
	 */
	function collapseForView() {
		state.collapsed = true;
	}

	return {
		get collapsed() {
			return state.collapsed;
		},
		toggle,
		collapseForView
	};
}

export const sidebar = createSidebarStore();
