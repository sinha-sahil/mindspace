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
		setOpen,
		toggle
	};
}

export const commandPalette = createStore();
