type StoreState = {
	open: boolean;
};

function createStore() {
	const state: StoreState = $state({ open: false });

	function setOpen(value: boolean) {
		state.open = value;
	}

	function toggle() {
		state.open = !state.open;
	}

	return {
		get open() {
			return state.open;
		},
		// Settable so the library CommandMenu can two-way `bind:open` to it —
		// its built-in Cmd+K toggle writes straight through this setter.
		set open(value: boolean) {
			state.open = value;
		},
		setOpen,
		toggle
	};
}

export const commandPalette = createStore();
