import { browser } from '$app/environment';

const STORAGE_KEY = 'mindspace::sidebar-collapsed';
const BAR_KEY = 'mindspace::sidebar-bar';

export type BarPosition = 'top' | 'left';

function readInitial(): boolean {
	if (!browser) {
		return false;
	}
	return localStorage.getItem(STORAGE_KEY) === '1';
}

function readBar(): BarPosition {
	if (!browser) {
		return 'top';
	}
	// Default is the top tab bar; 'left' restores the vertical icon rail.
	return localStorage.getItem(BAR_KEY) === 'left' ? 'left' : 'top';
}

function createSidebarStore() {
	const state = $state({ collapsed: readInitial(), barPosition: readBar() });

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

	function setBarPosition(pos: BarPosition) {
		state.barPosition = pos;
		if (browser) {
			localStorage.setItem(BAR_KEY, pos);
		}
	}

	return {
		get collapsed() {
			return state.collapsed;
		},
		get barPosition() {
			return state.barPosition;
		},
		/** True when the collapsed strip renders as a horizontal top bar. */
		get topBar() {
			return state.collapsed && state.barPosition === 'top';
		},
		toggle,
		collapseForView,
		setBarPosition
	};
}

export const sidebar = createSidebarStore();
