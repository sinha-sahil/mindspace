/**
 * Format helpers used across the app.
 * Centralized here so the components don't have to thread `undefined` for
 * `Intl.DateTimeFormat` locale defaults.
 */

const DATE_FORMATTER = new Intl.DateTimeFormat([], {
	year: 'numeric',
	month: 'short',
	day: 'numeric'
});

export function formatDate(input: string | number | Date | null): string {
	if (input === null) {
		return '—';
	}
	const date = input instanceof Date ? input : new Date(input);
	if (Number.isNaN(date.getTime())) {
		return '—';
	}
	return DATE_FORMATTER.format(date);
}

export function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) {
		return 'just now';
	}
	const m = Math.floor(diff / 60000);
	if (m < 60) {
		return `${m}m ago`;
	}
	const h = Math.floor(m / 60);
	if (h < 24) {
		return `${h}h ago`;
	}
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}
