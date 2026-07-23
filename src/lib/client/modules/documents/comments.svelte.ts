import type { Anchor } from './markdown';

/**
 * Server-shaped comment row. Mirrors what `/api/documents/[id]/comments`
 * returns — author email is resolved server-side via the admin client.
 */
type CommentApi = {
	id: string;
	document_id: string;
	parent_id: string | null;
	body: string;
	anchor_quote: string | null;
	anchor_prefix: string;
	anchor_suffix: string;
	anchor_start: number | null;
	anchor_end: number | null;
	created_by: string | null;
	created_at: string;
	author_email: string;
};

export type Comment = {
	id: string;
	documentId: string;
	parentId: string | null;
	body: string;
	anchorQuote: string | null;
	anchorPrefix: string;
	anchorSuffix: string;
	anchorStart: number | null;
	anchorEnd: number | null;
	createdBy: string | null;
	createdAt: number;
	authorEmail: string;
};

export type Thread = Comment & { replies: Comment[] };

export type CommentInput = {
	body: string;
} & Anchor;

function apiToComment(row: CommentApi): Comment {
	return {
		id: row.id,
		documentId: row.document_id,
		parentId: row.parent_id,
		body: row.body,
		anchorQuote: row.anchor_quote,
		anchorPrefix: row.anchor_prefix,
		anchorSuffix: row.anchor_suffix,
		anchorStart: row.anchor_start,
		anchorEnd: row.anchor_end,
		createdBy: row.created_by,
		createdAt: new Date(row.created_at).getTime(),
		authorEmail: row.author_email
	};
}

function createCommentsStore() {
	const state = $state<{
		items: Comment[];
		documentId: string | null;
		loading: boolean;
		error: string | null;
		/** Comment ids whose anchor couldn't be located in the rendered text.
		 *  Written by the editor after each highlight pass, read by
		 *  CommentsPanel to badge orphaned threads. */
		orphanIds: Set<string>;
	}>({
		items: [],
		documentId: null,
		loading: false,
		error: null,
		orphanIds: new Set()
	});

	async function loadFor(documentId: string) {
		state.documentId = documentId;
		state.loading = true;
		state.error = null;
		try {
			const res = await fetch(`/api/documents/${documentId}/comments`);
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			const data: { comments: CommentApi[] } = await res.json();
			state.items = data.comments.map(apiToComment);
		} catch (e) {
			state.error = e instanceof Error ? e.message : 'Failed to load comments';
		} finally {
			state.loading = false;
		}
	}

	/** Start a new thread: posts a root comment with anchor + first message. */
	async function startThread(documentId: string, input: CommentInput): Promise<Comment | null> {
		try {
			const res = await fetch(`/api/documents/${documentId}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					body: input.body,
					anchor_quote: input.quote,
					anchor_prefix: input.prefix,
					anchor_suffix: input.suffix,
					anchor_start: input.start,
					anchor_end: input.end
				})
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			const row: CommentApi = await res.json();
			const c = apiToComment(row);
			state.items = [c, ...state.items];
			return c;
		} catch (e) {
			state.error = e instanceof Error ? e.message : 'Failed to save comment';
			return null;
		}
	}

	/** Reply to an existing thread. */
	async function reply(
		documentId: string,
		parentId: string,
		body: string
	): Promise<Comment | null> {
		const text = body.trim();
		if (!text) {
			return null;
		}
		try {
			const res = await fetch(`/api/documents/${documentId}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: text, parent_id: parentId })
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
			const row: CommentApi = await res.json();
			const c = apiToComment(row);
			state.items = [...state.items, c];
			return c;
		} catch (e) {
			state.error = e instanceof Error ? e.message : 'Failed to send reply';
			return null;
		}
	}

	/** Delete a single comment row. If it's a thread root, RLS cascade removes replies. */
	async function remove(documentId: string, commentId: string) {
		const previous = state.items;
		// Optimistic removal: drop the row + any descendants (since cascade handles it server-side).
		state.items = state.items.filter((c) => c.id !== commentId && c.parentId !== commentId);
		try {
			const res = await fetch(`/api/documents/${documentId}/comments/${commentId}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				throw new Error((await res.text()) || `Request failed (${res.status})`);
			}
		} catch (e) {
			state.items = previous;
			state.error = e instanceof Error ? e.message : 'Failed to delete';
		}
	}

	function reset() {
		state.items = [];
		state.documentId = null;
		state.loading = false;
		state.error = null;
		state.orphanIds = new Set();
	}

	function setOrphans(ids: Set<string>) {
		state.orphanIds = ids;
	}

	function isOrphan(commentId: string): boolean {
		return state.orphanIds.has(commentId);
	}

	return {
		get items() {
			return state.items;
		},
		get documentId() {
			return state.documentId;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		/** Threads in display order (newest first) with replies attached (oldest first). */
		get threads(): Thread[] {
			const roots = state.items.filter((c) => !c.parentId);
			return roots.map((root) => ({
				...root,
				replies: state.items
					.filter((c) => c.parentId === root.id)
					.sort((a, b) => a.createdAt - b.createdAt)
			}));
		},
		loadFor,
		startThread,
		reply,
		remove,
		reset,
		setOrphans,
		isOrphan
	};
}

export const comments = createCommentsStore();
