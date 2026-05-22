import type { RealtimeChannel } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '../../../../app';
import { colorForKey } from '$lib/client/utils/color';
import { analytics } from '../analytics';

/**
 * Per-project realtime collaboration over Supabase Realtime.
 *
 *  - presence:  who's currently viewing this project
 *  - broadcast: pointer + scene element changes
 *
 * Each connected peer sends pointer updates (throttled) and full element
 * snapshots (throttled). Receivers reconcile element snapshots against their
 * local copy by element version, so concurrent edits don't clobber each
 * other when the network re-orders broadcasts.
 */

export type Pointer = { x: number; y: number };
export type PointerButton = 'down' | 'up';

export type Peer = {
	id: string; // unique per tab/connection
	userId: string;
	email: string;
	name: string;
	color: { from: string; to: string; name: string };
	pointer?: Pointer;
	button?: PointerButton;
	selectedElementIds?: Record<string, true>;
};

type ElementWithVersion = {
	id: string;
	version?: number;
	versionNonce?: number;
	[key: string]: unknown;
};

type PresenceMeta = {
	id: string; // tab session id (unique per browser tab)
	userId: string;
	email: string;
	name: string;
};

type PointerMessage = {
	id: string; // sender tab session id
	pointer: Pointer | null;
	button?: PointerButton;
	selectedElementIds?: Record<string, true>;
};

type SceneMessage = {
	id: string; // sender tab session id
	elements: ElementWithVersion[];
};

function newSessionId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

type Listeners = {
	onRemoteScene?: (elements: ElementWithVersion[]) => void;
};

const POINTER_THROTTLE_MS = 50;
const SCENE_THROTTLE_MS = 120;

function makeThrottle<Args extends unknown[]>(
	fn: (...args: Args) => void,
	ms: number
): (...args: Args) => void {
	let lastSent = 0;
	let pending: { args: Args } | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function flush() {
		if (!pending) {
			return;
		}
		lastSent = Date.now();
		const { args } = pending;
		pending = null;
		fn(...args);
	}

	return (...args: Args) => {
		const now = Date.now();
		const elapsed = now - lastSent;
		pending = { args };
		if (elapsed >= ms) {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			flush();
		} else if (!timer) {
			timer = setTimeout(() => {
				timer = null;
				flush();
			}, ms - elapsed);
		}
	};
}

function createCollab() {
	const state = $state<{ peers: Peer[]; connected: boolean }>({
		peers: [],
		connected: false
	});

	let channel: RealtimeChannel | null = null;
	let mySessionId: string | null = null; // unique per tab/connection
	let myUserId = '';
	let myEmail = '';
	let myName = '';
	let listeners: Listeners = {};
	let currentProjectId: string | null = null;

	function disconnect() {
		if (channel) {
			channel.unsubscribe();
			channel = null;
		}
		state.peers = [];
		state.connected = false;
		currentProjectId = null;
		mySessionId = null;
		listeners = {};
	}

	function connect(
		supabase: AppSupabaseClient,
		projectId: string,
		user: { id: string; email: string },
		nextListeners: Listeners
	) {
		// Same project + same user/tab combo? keep the existing channel.
		if (channel && currentProjectId === projectId && myUserId === user.id && mySessionId) {
			listeners = nextListeners;
			return;
		}
		disconnect();

		mySessionId = newSessionId();
		myUserId = user.id;
		myEmail = user.email;
		myName = user.email.split('@')[0] || user.email;
		listeners = nextListeners;
		currentProjectId = projectId;

		// Presence is keyed per *tab session*, not per user, so the same person
		// open in two tabs (or on phone + laptop) sees themselves as a peer too.
		const ch = supabase.channel(`project:${projectId}`, {
			config: {
				presence: { key: mySessionId },
				broadcast: { self: false, ack: false }
			}
		});

		ch.on('presence', { event: 'sync' }, () => {
			rebuildPeers(ch);
		});

		ch.on('broadcast', { event: 'pointer' }, ({ payload }) => {
			applyPointer(payload as PointerMessage);
		});

		ch.on('broadcast', { event: 'scene' }, ({ payload }) => {
			const msg = payload as SceneMessage;
			if (!msg || msg.id === mySessionId) {
				return;
			}
			listeners.onRemoteScene?.(msg.elements ?? []);
		});

		ch.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				state.connected = true;
				const meta: PresenceMeta = {
					id: mySessionId!,
					userId: myUserId,
					email: myEmail,
					name: myName
				};
				ch.track(meta);
				analytics.track('multiplayer_session_started', { project_id: projectId });
			} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
				state.connected = false;
				console.warn('[collab] channel status:', status);
			}
		});

		channel = ch;
	}

	function rebuildPeers(ch: RealtimeChannel) {
		const presenceState = ch.presenceState() as Record<string, PresenceMeta[]>;
		const next: Peer[] = [];
		for (const key in presenceState) {
			if (key === mySessionId) {
				continue; // skip our own tab
			}
			const metas = presenceState[key];
			const meta = metas[metas.length - 1];
			if (!meta) {
				continue;
			}
			const existing = state.peers.find((p) => p.id === meta.id);
			next.push({
				id: meta.id,
				userId: meta.userId,
				email: meta.email,
				name: meta.name,
				color: colorForKey(meta.email),
				pointer: existing?.pointer,
				button: existing?.button,
				selectedElementIds: existing?.selectedElementIds
			});
		}
		state.peers = next;
	}

	function applyPointer(msg: PointerMessage) {
		if (!msg || msg.id === mySessionId) {
			return;
		}
		const idx = state.peers.findIndex((p) => p.id === msg.id);
		if (idx === -1) {
			return;
		}
		const peer = state.peers[idx];
		state.peers[idx] = {
			...peer,
			pointer: msg.pointer ?? undefined,
			button: msg.button,
			selectedElementIds: msg.selectedElementIds
		};
	}

	const _sendPointer = (payload: PointerMessage) => {
		// Only send via the live WebSocket: skip if the channel hasn't fully
		// subscribed yet. Otherwise supabase-js falls back to REST (which is
		// slower, doesn't deliver to peers, and is being deprecated).
		if (!channel || !state.connected) {
			return;
		}
		channel.send({ type: 'broadcast', event: 'pointer', payload });
	};
	const _sendScene = (payload: SceneMessage) => {
		if (!channel || !state.connected) {
			return;
		}
		channel.send({ type: 'broadcast', event: 'scene', payload });
	};
	const sendPointerThrottled = makeThrottle(_sendPointer, POINTER_THROTTLE_MS);
	const sendSceneThrottled = makeThrottle(_sendScene, SCENE_THROTTLE_MS);

	function broadcastPointer(
		pointer: Pointer | null,
		button: PointerButton | undefined,
		selectedElementIds: Record<string, true> | undefined
	) {
		if (!channel || !mySessionId || !state.connected) {
			return;
		}
		sendPointerThrottled({ id: mySessionId, pointer, button, selectedElementIds });
	}

	function broadcastScene(elements: ReadonlyArray<ElementWithVersion>) {
		if (!channel || !mySessionId || !state.connected) {
			return;
		}
		sendSceneThrottled({ id: mySessionId, elements: elements as ElementWithVersion[] });
	}

	return {
		get peers() {
			return state.peers;
		},
		get connected() {
			return state.connected;
		},
		connect,
		disconnect,
		broadcastPointer,
		broadcastScene
	};
}

export const collab = createCollab();

/**
 * Reconcile a remote element snapshot with the local current scene by
 * element id + version. Elements with a higher version (or higher
 * versionNonce on tie) win; missing elements on either side are kept.
 *
 * Order of the returned array preserves the LOCAL ordering for elements
 * present locally, then appends remote-only elements at the end.
 */
export function reconcileElements(
	local: ReadonlyArray<ElementWithVersion>,
	remote: ReadonlyArray<ElementWithVersion>
): ElementWithVersion[] {
	const remoteById = new Map<string, ElementWithVersion>();
	for (const el of remote) {
		remoteById.set(el.id, el);
	}
	const result: ElementWithVersion[] = [];
	const seen = new Set<string>();

	for (const localEl of local) {
		const remoteEl = remoteById.get(localEl.id);
		if (remoteEl && isNewer(remoteEl, localEl)) {
			result.push(remoteEl);
		} else {
			result.push(localEl);
		}
		seen.add(localEl.id);
	}

	for (const remoteEl of remote) {
		if (!seen.has(remoteEl.id)) {
			result.push(remoteEl);
		}
	}

	return result;
}

function isNewer(a: ElementWithVersion, b: ElementWithVersion): boolean {
	const va = a.version ?? 0;
	const vb = b.version ?? 0;
	if (va !== vb) {
		return va > vb;
	}
	const na = a.versionNonce ?? 0;
	const nb = b.versionNonce ?? 0;
	return na > nb;
}
