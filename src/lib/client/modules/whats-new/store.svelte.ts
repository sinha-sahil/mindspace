import { browser } from '$app/environment';
import { CHANGELOG, latestReleaseId, type Release } from './changelog';

/**
 * "What's new" announcer state.
 *
 *  - `check()` runs once on app open. If the user hasn't seen the latest
 *    release, the modal opens showing every release newer than the last one
 *    they saw.
 *  - First-ever visit (no stored id) shows just the most recent release, so a
 *    brand-new user gets a one-line "here's what's cool" rather than the whole
 *    backlog.
 *  - `show()` opens it manually (from the user menu).
 *  - `dismiss()` closes it and records the latest release as seen.
 */

const SEEN_KEY = 'mindspace::whats-new-seen';

function createWhatsNew() {
	let open = $state(false);
	let releases = $state<Release[]>([]);

	function releasesNewerThan(seenId: string | null): Release[] {
		if (CHANGELOG.length === 0) {
			return [];
		}
		if (!seenId) {
			return [CHANGELOG[0]];
		}
		const idx = CHANGELOG.findIndex((r) => r.id === seenId);
		// Unknown id (changelog rewritten) — fall back to just the latest.
		return idx === -1 ? [CHANGELOG[0]] : CHANGELOG.slice(0, idx);
	}

	function check() {
		if (!browser || CHANGELOG.length === 0) {
			return;
		}
		const seen = localStorage.getItem(SEEN_KEY);
		if (seen === latestReleaseId()) {
			return;
		}
		const toShow = releasesNewerThan(seen);
		if (toShow.length === 0) {
			return;
		}
		releases = toShow;
		open = true;
	}

	function show() {
		if (CHANGELOG.length === 0) {
			return;
		}
		releases = [CHANGELOG[0]];
		open = true;
	}

	function dismiss() {
		open = false;
		if (browser) {
			localStorage.setItem(SEEN_KEY, latestReleaseId());
		}
	}

	return {
		get open() {
			return open;
		},
		get releases() {
			return releases;
		},
		check,
		show,
		dismiss
	};
}

export const whatsNew = createWhatsNew();
