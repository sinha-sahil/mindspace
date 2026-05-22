import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import posthog from 'posthog-js';

/**
 * Lightweight wrapper around posthog-js.
 *
 *  - SSR-safe: every method is a no-op on the server.
 *  - Typed event names + property shapes (see Event below) so we don't drift
 *    between call sites.
 *  - Init is idempotent — call from the layout once.
 *
 * Set PUBLIC_POSTHOG_KEY and (optionally) PUBLIC_POSTHOG_HOST in Vercel.
 * If the key is missing, the wrapper silently no-ops, so dev / preview
 * deploys without analytics keys still work.
 */

type IdentifyProps = { email?: string; isAdmin?: boolean };

export type EventMap = {
	user_signed_in: { method?: 'magic_link' | 'passkey' };
	user_signed_out: Record<string, never>;

	workspace_created: { workspace_id: string };
	workspace_renamed: { workspace_id: string };
	workspace_deleted: { workspace_id: string };
	workspace_member_added: { workspace_id: string; role: 'editor' | 'viewer' };
	workspace_member_removed: { workspace_id: string };
	workspace_member_role_changed: { workspace_id: string; role: 'editor' | 'viewer' };
	workspace_switched: { workspace_id: string };

	project_created: { workspace_id: string; project_id: string };
	project_renamed: { project_id: string };
	project_deleted: { project_id: string };
	project_visibility_changed: { project_id: string; visibility: 'private' | 'link' };
	project_link_copied: { project_id: string };
	project_moved_to_workspace: { project_id: string; to_workspace_id: string };
	project_reordered: { project_id: string };

	multiplayer_session_started: { project_id: string };
};

type EventName = keyof EventMap;

let initialised = false;

function ready(): boolean {
	return browser && initialised;
}

export const analytics = {
	/**
	 * Initialise the SDK. Safe to call multiple times — second call is a no-op.
	 * Returns true if PostHog was initialised, false otherwise (missing key /
	 * server-side / etc.).
	 */
	init(): boolean {
		if (!browser || initialised) {
			return initialised;
		}
		const key = env.PUBLIC_POSTHOG_KEY;
		if (!key) {
			return false;
		}
		const host = env.PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
		posthog.init(key, {
			api_host: host,
			capture_pageview: true,
			capture_pageleave: true,
			autocapture: true,
			persistence: 'localStorage+cookie',
			disable_session_recording: false
		});
		initialised = true;
		return true;
	},

	/**
	 * Tie subsequent events to a known user. Call after a successful sign-in.
	 */
	identify(userId: string, props?: IdentifyProps) {
		if (!ready()) {
			return;
		}
		posthog.identify(userId, props);
	},

	/**
	 * Forget the current identity (call on sign-out).
	 */
	reset() {
		if (!ready()) {
			return;
		}
		posthog.reset();
	},

	/**
	 * Fire a typed event.
	 */
	track<E extends EventName>(event: E, props?: EventMap[E]) {
		if (!ready()) {
			return;
		}
		posthog.capture(event, props);
	}
};
