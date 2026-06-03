import { browser } from '$app/environment';

/**
 * Split-screen view state.
 *
 * The left pane always shows the projects store's active project. The right
 * pane shows `rightId`. `focused` decides which pane sidebar clicks target and
 * which pane gets live multiplayer. `ratio` is the left pane's width fraction.
 */

export type Pane = 'left' | 'right';

const RATIO_KEY = 'mindspace::split-ratio';
const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;

function clampRatio(r: number): number {
	if (Number.isNaN(r)) {
		return 0.5;
	}
	return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

function readRatio(): number {
	if (!browser) {
		return 0.5;
	}
	const raw = localStorage.getItem(RATIO_KEY);
	return raw ? clampRatio(parseFloat(raw)) : 0.5;
}

function createSplitView() {
	const state = $state<{
		enabled: boolean;
		rightId: string | null;
		focused: Pane;
		ratio: number;
	}>({
		enabled: false,
		rightId: null,
		focused: 'left',
		ratio: readRatio()
	});

	/** Open `projectId` in the right pane and enter split mode. */
	function openInSplit(projectId: string) {
		state.rightId = projectId;
		state.enabled = true;
		state.focused = 'right';
	}

	/** Enter split mode with an empty right pane (user picks next). */
	function enable() {
		state.enabled = true;
		state.focused = 'right';
	}

	/** Leave split mode — the left pane becomes the sole view. */
	function close() {
		state.enabled = false;
		state.rightId = null;
		state.focused = 'left';
	}

	function toggle() {
		if (state.enabled) {
			close();
		} else {
			enable();
		}
	}

	/** Set the right pane's project (used by sidebar clicks when focused). */
	function setRight(projectId: string) {
		state.rightId = projectId;
	}

	function focus(pane: Pane) {
		state.focused = pane;
	}

	function setRatio(r: number) {
		state.ratio = clampRatio(r);
		if (browser) {
			localStorage.setItem(RATIO_KEY, String(state.ratio));
		}
	}

	return {
		get enabled() {
			return state.enabled;
		},
		get rightId() {
			return state.rightId;
		},
		get focused() {
			return state.focused;
		},
		get ratio() {
			return state.ratio;
		},
		openInSplit,
		enable,
		close,
		toggle,
		setRight,
		focus,
		setRatio
	};
}

export const splitView = createSplitView();
