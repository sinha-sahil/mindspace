export type ToastKind = 'success' | 'error' | 'info';

export type ToastAction = {
	label: string;
	onClick: () => void;
};

export type Toast = {
	id: string;
	kind: ToastKind;
	title: string;
	description: string | null;
	action: ToastAction | null;
	createdAt: number;
	duration: number;
};

type StoreState = {
	items: Toast[];
};

function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

function createStore() {
	const state: StoreState = $state({ items: [] });
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function dismiss(id: string) {
		state.items = state.items.filter((t) => t.id !== id);
		const timer = timers.get(id);
		if (timer) {
			clearTimeout(timer);
			timers.delete(id);
		}
	}

	function push(
		kind: ToastKind,
		title: string,
		opts: {
			description?: string;
			action?: ToastAction;
			duration?: number;
		} = {}
	): string {
		const id = uid();
		const duration = opts.duration ?? (kind === 'error' ? 6000 : 3500);
		const toast: Toast = {
			id,
			kind,
			title,
			description: opts.description ?? null,
			action: opts.action ?? null,
			createdAt: Date.now(),
			duration
		};
		state.items = [...state.items, toast];
		const timer = setTimeout(() => dismiss(id), duration);
		timers.set(id, timer);
		return id;
	}

	return {
		get items() {
			return state.items;
		},
		dismiss,
		success: (title: string, opts?: Parameters<typeof push>[2]) => push('success', title, opts),
		error: (title: string, opts?: Parameters<typeof push>[2]) => push('error', title, opts),
		info: (title: string, opts?: Parameters<typeof push>[2]) => push('info', title, opts)
	};
}

export const toasts = createStore();
