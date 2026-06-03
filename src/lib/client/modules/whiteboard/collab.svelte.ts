import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ExcalidrawProps } from '@excalidraw/excalidraw/types';
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
	pointer?: Pointer | null;
	button?: PointerButton;
};

/**
 * A scene element as far as collaboration cares — the real Excalidraw element
 * type, derived from the onChange signature so no import path is pinned. Only
 * id / version / versionNonce are read during reconcile.
 */
export type SceneElement = Parameters<NonNullable<ExcalidrawProps['onChange']>>[0][number];

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
};

type SceneMessage = {
	id: string; // sender tab session id
	elements: readonly SceneElement[];
};

type Listeners = {
	onRemoteScene?: (elements: readonly SceneElement[]) => void;
};

function newSessionId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

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
		const elapsed = Date.now() - lastSent;
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

/** Validate an incoming pointer broadcast — never trust the wire shape. */
function readPointerMessage(raw: unknown): PointerMessage | null {
	if (typeof raw !== 'object' || raw === null || !('id' in raw)) {
		return null;
	}
	if (typeof raw.id !== 'string') {
		return null;
	}
	let pointer: Pointer | null = null;
	if (
		'pointer' in raw &&
		typeof raw.pointer === 'object' &&
		raw.pointer !== null &&
		'x' in raw.pointer &&
		'y' in raw.pointer &&
		typeof raw.pointer.x === 'number' &&
		typeof raw.pointer.y === 'number'
	) {
		pointer = { x: raw.pointer.x, y: raw.pointer.y };
	}
	const message: PointerMessage = { id: raw.id, pointer };
	if ('button' in raw && (raw.button === 'down' || raw.button === 'up')) {
		message.button = raw.button;
	}
	return message;
}

function createCollab() {
	const state = $state<{ peers: Peer[]; connected: boolean }>({
		peers: [],
		connected: false
	});

	let channel: RealtimeChannel | null = null;
	let mySessionId: string | null = null;
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

		const sessionId = newSessionId();
		mySessionId = sessionId;
		myUserId = user.id;
		myEmail = user.email;
		myName = user.email.split('@')[0] || user.email;
		listeners = nextListeners;
		currentProjectId = projectId;

		// Presence is keyed per *tab session*, not per user, so the same person
		// open in two tabs (or on phone + laptop) sees themselves as a peer too.
		const ch = supabase.channel(`project:${projectId}`, {
			config: {
				presence: { key: sessionId },
				broadcast: { self: false, ack: false }
			}
		});

		ch.on('presence', { event: 'sync' }, () => {
			rebuildPeers(ch);
		});

		ch.on('broadcast', { event: 'pointer' }, ({ payload }) => {
			const msg = readPointerMessage(payload);
			if (msg) {
				applyPointer(msg);
			}
		});

		ch.on('broadcast', { event: 'scene' }, ({ payload }) => {
			if (typeof payload !== 'object' || payload === null) {
				return;
			}
			if (!('id' in payload) || payload.id === mySessionId) {
				return;
			}
			// Array.isArray narrows elements to a usable array; the items are
			// full Excalidraw elements serialised by the sender.
			if ('elements' in payload && Array.isArray(payload.elements)) {
				listeners.onRemoteScene?.(payload.elements);
			}
		});

		ch.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				state.connected = true;
				const meta: PresenceMeta = {
					id: sessionId,
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
		const presenceState = ch.presenceState<PresenceMeta>();
		const next: Peer[] = [];
		for (const key in presenceState) {
			if (key === mySessionId) {
				continue;
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
				button: existing?.button
			});
		}
		state.peers = next;
	}

	function applyPointer(msg: PointerMessage) {
		if (msg.id === mySessionId) {
			return;
		}
		const idx = state.peers.findIndex((p) => p.id === msg.id);
		if (idx === -1) {
			return;
		}
		state.peers[idx] = {
			...state.peers[idx],
			pointer: msg.pointer,
			button: msg.button
		};
	}

	function send(event: 'pointer' | 'scene', payload: PointerMessage | SceneMessage) {
		// Only send over the live WebSocket: skip until the channel has fully
		// subscribed, otherwise supabase-js falls back to a (deprecated) REST
		// path that doesn't reach peers.
		if (!channel || !state.connected) {
			return;
		}
		channel.send({ type: 'broadcast', event, payload });
	}

	const sendPointerThrottled = makeThrottle(
		(p: PointerMessage) => send('pointer', p),
		POINTER_THROTTLE_MS
	);
	const sendSceneThrottled = makeThrottle((s: SceneMessage) => send('scene', s), SCENE_THROTTLE_MS);

	function broadcastPointer(pointer: Pointer | null, button?: PointerButton) {
		if (!channel || !mySessionId || !state.connected) {
			return;
		}
		sendPointerThrottled({ id: mySessionId, pointer, button });
	}

	function broadcastScene(elements: readonly SceneElement[]) {
		if (!channel || !mySessionId || !state.connected) {
			return;
		}
		sendSceneThrottled({ id: mySessionId, elements });
	}

	/**
	 * Disconnect only if currently connected to `projectId`. Used by panes on
	 * unmount so a closing pane doesn't tear down a channel another pane took
	 * over.
	 */
	function leaveProject(projectId: string) {
		if (currentProjectId === projectId) {
			disconnect();
		}
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
		leaveProject,
		broadcastPointer,
		broadcastScene
	};
}

export const collab = createCollab();

/**
 * Reconcile a remote element snapshot with the local current scene by element
 * id + version. Elements with a higher version (or higher versionNonce on a
 * tie) win; elements present on only one side are kept. Local ordering is
 * preserved, with remote-only elements appended.
 */
export function reconcileElements<
	T extends { id: string; version?: number; versionNonce?: number }
>(local: readonly T[], remote: readonly T[]): T[] {
	const remoteById = new Map<string, T>();
	for (const el of remote) {
		remoteById.set(el.id, el);
	}
	const result: T[] = [];
	const seen = new Set<string>();

	for (const localEl of local) {
		const remoteEl = remoteById.get(localEl.id);
		result.push(remoteEl && isNewer(remoteEl, localEl) ? remoteEl : localEl);
		seen.add(localEl.id);
	}
	for (const remoteEl of remote) {
		if (!seen.has(remoteEl.id)) {
			result.push(remoteEl);
		}
	}
	return result;
}

function isNewer(
	a: { version?: number; versionNonce?: number },
	b: { version?: number; versionNonce?: number }
): boolean {
	const va = a.version ?? 0;
	const vb = b.version ?? 0;
	if (va !== vb) {
		return va > vb;
	}
	return (a.versionNonce ?? 0) > (b.versionNonce ?? 0);
}
