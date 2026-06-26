import { error, json, type RequestHandler } from '@sveltejs/kit';

/**
 * MCP server over HTTP (Streamable HTTP transport, stateless mode).
 *
 * Lets any MCP-aware client (Claude Code, Claude Desktop, Cursor, etc.)
 * connect with just a URL + Bearer token — no local install, no Node, no
 * git clone. Each request is a single JSON-RPC message; we respond inline
 * with a single JSON-RPC response. No SSE / session-id machinery needed
 * because none of our tools stream or initiate server→client messages.
 *
 * Auth runs in hooks.server.ts (the same Bearer flow used by /api/mcp/*).
 * By the time this handler fires, `locals.user` is set and `locals.isMember`
 * is true. Tools call the existing /api/mcp/* endpoints via `event.fetch`
 * (in-process — no real network hop) with the original Authorization header
 * forwarded, so business logic stays in one place.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http
 */

const PROTOCOL_VERSION = '2024-11-05';

type JsonRpcResponse = {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

// --- tool catalog ----------------------------------------------------------

type ToolDef = {
	name: string;
	title: string;
	description: string;
	inputSchema: object;
};

const TOOLS: ToolDef[] = [
	{
		name: 'list_workspaces',
		title: 'List Workspaces',
		description:
			'List the workspaces this token can access. Returns id, name, role (owner | editor | viewer), and created_at. Call this first to discover which workspace_id to pass to other tools.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false }
	},
	{
		name: 'list_projects',
		title: 'List Projects',
		description:
			'List projects in a workspace. Optional kind filter ("whiteboard", "doc", "todo", or "sheet") narrows the result. Each project has id, name, kind, visibility, created_at, updated_at.',
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: {
					type: 'string',
					format: 'uuid',
					description: 'UUID of the workspace, from list_workspaces.'
				},
				kind: {
					type: 'string',
					enum: ['whiteboard', 'doc', 'todo', 'sheet'],
					description: 'Filter by kind. Omit to get all.'
				}
			},
			required: ['workspace_id'],
			additionalProperties: false
		}
	},
	{
		name: 'create_whiteboard_project',
		title: 'Create Whiteboard Project',
		description:
			"Create a new whiteboard project in a workspace, optionally seeded with an Excalidraw scene. Scene shape: { elements: ExcalidrawElement[], appState?: object, files?: object }. Each element needs at least { id, type, x, y, width, height, ... }. Common types: 'rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'freedraw'.",
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', format: 'uuid' },
				name: { type: 'string', minLength: 1, maxLength: 120 },
				scene: {
					description: 'Optional Excalidraw scene JSON. Omit for an empty canvas.'
				}
			},
			required: ['workspace_id', 'name'],
			additionalProperties: false
		}
	},
	{
		name: 'create_doc_project',
		title: 'Create Doc Project',
		description:
			'Create a new doc project (a folder for markdown documents). Use upload_markdown afterwards to add files to it.',
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', format: 'uuid' },
				name: { type: 'string', minLength: 1, maxLength: 120 }
			},
			required: ['workspace_id', 'name'],
			additionalProperties: false
		}
	},
	{
		name: 'create_todo_project',
		title: 'Create Todo List Project',
		description:
			'Create a new todo-list project: nested checkboxes grouped into sections and arranged across one or more columns on a free canvas.',
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', format: 'uuid' },
				name: { type: 'string', minLength: 1, maxLength: 120 }
			},
			required: ['workspace_id', 'name'],
			additionalProperties: false
		}
	},
	{
		name: 'create_sheet_project',
		title: 'Create Spreadsheet Project',
		description:
			'Create a new spreadsheet project: a workbook of cells with formulas, multiple tabs, and formatting. Opens with one empty "Sheet1". Use set_sheet_cells to populate it and get_sheet to read it back with computed values.',
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string', format: 'uuid' },
				name: { type: 'string', minLength: 1, maxLength: 120 }
			},
			required: ['workspace_id', 'name'],
			additionalProperties: false
		}
	},
	{
		name: 'get_sheet',
		title: 'Read Spreadsheet',
		description:
			'Read every tab of a spreadsheet project. Returns each sheet with its id, name, grid size, and a map of non-empty cells keyed by A1 address — each cell carries its raw `value` (a literal or "=formula"), the engine-`computed` value, and a formatted `display` string.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: { type: 'string', format: 'uuid' }
			},
			required: ['project_id'],
			additionalProperties: false
		}
	},
	{
		name: 'set_sheet_cells',
		title: 'Write Spreadsheet Cells',
		description:
			'Write raw inputs to cells of a spreadsheet by A1 address. Each cell `value` is a literal ("hello", "42", "TRUE") or a formula beginning with "=" (e.g. "=SUM(A1:A10)", "=B2*1.2"). An empty value clears the cell. Targets the active tab by default; pass sheet_id or sheet_name to choose another (set create_sheet:true to add a new named tab). Returns the updated sheet with recomputed values.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: { type: 'string', format: 'uuid' },
				cells: {
					type: 'array',
					minItems: 1,
					items: {
						type: 'object',
						properties: {
							a1: { type: 'string', description: 'Cell address, e.g. "A1", "B12", "AA3".' },
							value: {
								type: 'string',
								description: 'Literal or "=formula". Empty clears the cell.'
							}
						},
						required: ['a1', 'value'],
						additionalProperties: false
					}
				},
				sheet_id: { type: 'string', description: 'Target tab by id (from get_sheet).' },
				sheet_name: { type: 'string', description: 'Target tab by name instead of id.' },
				create_sheet: {
					type: 'boolean',
					description: 'If true and sheet_name does not exist, create it.'
				}
			},
			required: ['project_id', 'cells'],
			additionalProperties: false
		}
	},
	{
		name: 'list_documents',
		title: 'List Documents',
		description:
			'List markdown documents in a doc project. Returns id, name, content, position, created_at, updated_at for each.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: { type: 'string', format: 'uuid' }
			},
			required: ['project_id'],
			additionalProperties: false
		}
	},
	{
		name: 'upload_markdown',
		title: 'Upload Markdown Document',
		description:
			'Create a NEW markdown document inside a doc project. The project must have kind="doc" (use create_doc_project first if needed). For refreshing an existing document, use update_markdown — re-uploading creates a duplicate and orphans the original\'s comment threads.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: { type: 'string', format: 'uuid' },
				name: { type: 'string', minLength: 1, maxLength: 200 },
				content: { type: 'string' }
			},
			required: ['project_id', 'name', 'content'],
			additionalProperties: false
		}
	},
	{
		name: 'update_markdown',
		title: 'Update Markdown Document In Place',
		description:
			"Replace an existing document's content (and optionally its name) in place. Preserves document_id, project_id, position, created_at, and every attached comment thread — the canonical use for pushing fresh source into mindspace after editing externally. Anchors are not rewritten server-side; the frontend's renderer handles drift via a prefix+quote+suffix fallback, so a thread whose quoted text still appears anywhere in the updated document remains visible. Threads whose quote no longer appears at all stay attached but lose their visual highlight until a reader points them back. Editor access required.",
		inputSchema: {
			type: 'object',
			properties: {
				document_id: {
					type: 'string',
					format: 'uuid',
					description: 'UUID of the document to update.'
				},
				content: {
					type: 'string',
					description: 'New markdown body. Omit to update only the name.'
				},
				name: {
					type: 'string',
					minLength: 1,
					maxLength: 200,
					description: 'New filename. Omit to leave unchanged.'
				}
			},
			required: ['document_id'],
			additionalProperties: false
		}
	},
	{
		name: 'get_document_comments',
		title: 'Get Document Comments',
		description:
			'Fetch text-anchored comment threads on a single document. Without filters, returns every comment. Pass `quote` for exact-text match. Pass `start` + `end` (plain-text character offsets) for range overlap. Each comment includes parent_id (null for roots, root id for replies), body, anchor fields, author_email, created_at, and resolution fields (resolved_at, resolved_by, resolved_by_email).',
		inputSchema: {
			type: 'object',
			properties: {
				document_id: { type: 'string', format: 'uuid' },
				quote: { type: 'string' },
				start: { type: 'integer', minimum: 0 },
				end: { type: 'integer', minimum: 0 }
			},
			required: ['document_id'],
			additionalProperties: false
		}
	},
	{
		name: 'get_project_comments',
		title: 'Get All Project Comments',
		description:
			'Fetch every comment across every document in a project in one call — ideal for triaging open conversations. Each comment carries its document_id, so the caller can group by file. Optional `state` filters thread roots by resolution status (replies for matching roots always come along). Optional `document_id` narrows to one document inside the project. Returns the same fields as get_document_comments, including resolution metadata.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: { type: 'string', format: 'uuid' },
				state: {
					type: 'string',
					enum: ['open', 'resolved', 'all'],
					description: 'Filter thread roots by resolution state. Defaults to "all".'
				},
				document_id: {
					type: 'string',
					format: 'uuid',
					description: 'Optional: narrow to one document within the project.'
				}
			},
			required: ['project_id'],
			additionalProperties: false
		}
	},
	{
		name: 'reply_to_comment',
		title: 'Reply to Comment Thread',
		description:
			"Post a chat-style reply on a comment thread. `comment_id` must be a thread ROOT (parent_id is null) — passing a reply id is rejected so the LLM cannot accidentally create nested branches. The reply inherits the root's document + anchor; you only supply the message body.",
		inputSchema: {
			type: 'object',
			properties: {
				comment_id: {
					type: 'string',
					format: 'uuid',
					description: 'UUID of the thread root comment to reply to.'
				},
				body: {
					type: 'string',
					minLength: 1,
					description: 'Reply text. Markdown is preserved.'
				}
			},
			required: ['comment_id', 'body'],
			additionalProperties: false
		}
	},
	{
		name: 'resolve_comment',
		title: 'Resolve / Reopen Comment Thread',
		description:
			'Mark a comment thread resolved (default) or reopen it (`resolved: false`). Acts on the thread ROOT — pass the root comment id, not a reply. Resolution is collaborative: any workspace member can toggle the state.',
		inputSchema: {
			type: 'object',
			properties: {
				comment_id: {
					type: 'string',
					format: 'uuid',
					description: 'UUID of the thread root.'
				},
				resolved: {
					type: 'boolean',
					description: 'true (default) marks the thread resolved. false reopens it.'
				}
			},
			required: ['comment_id'],
			additionalProperties: false
		}
	}
];

// --- helpers ---------------------------------------------------------------

/**
 * Convert `unknown` to a string-keyed record without using a type assertion.
 * Returns null if `value` isn't a plain object.
 */
function toRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = v;
	}
	return out;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function callApi(
	fetchFn: typeof fetch,
	authHeader: string,
	method: 'GET' | 'POST' | 'PATCH',
	path: string,
	body?: unknown
): Promise<unknown> {
	const headers: Record<string, string> = {
		authorization: authHeader,
		accept: 'application/json'
	};
	const init: RequestInit = { method, headers };
	if (body !== null && typeof body !== 'undefined') {
		headers['content-type'] = 'application/json';
		init.body = JSON.stringify(body);
	}
	const res = await fetchFn(path, init);
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`mindspace ${method} ${path} → ${res.status}: ${text || res.statusText}`);
	}
	if (!text) {
		return {};
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function toolResult(value: unknown): unknown {
	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(value, null, 2)
			}
		]
	};
}

// --- request handler -------------------------------------------------------

async function handle(
	req: Record<string, unknown>,
	ctx: { fetch: typeof fetch; authHeader: string }
): Promise<JsonRpcResponse | null> {
	const idRaw = req.id;
	const id: string | number | null =
		typeof idRaw === 'string' || typeof idRaw === 'number' ? idRaw : null;
	const method = asString(req.method);
	const params = toRecord(req.params) ?? {};

	if (!method) {
		return {
			jsonrpc: '2.0',
			id,
			error: { code: -32600, message: 'method is required' }
		};
	}

	switch (method) {
		case 'initialize':
			return {
				jsonrpc: '2.0',
				id,
				result: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: 'mindspace', version: '1.0.0' },
					instructions:
						'Use list_workspaces first to discover workspace_ids. For doc projects, use create_doc_project then upload_markdown. For whiteboards, create_whiteboard_project can optionally accept an Excalidraw scene. For spreadsheets, create_sheet_project then set_sheet_cells (write literals or "=formulas" by A1 address) and get_sheet to read computed values.'
				}
			};

		case 'notifications/initialized':
		case 'notifications/cancelled':
			// Notifications don't get a response — return null and the handler
			// will respond 204.
			return null;

		case 'ping':
			return { jsonrpc: '2.0', id, result: {} };

		case 'tools/list':
			return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

		case 'tools/call': {
			const name = asString(params.name);
			const args = toRecord(params.arguments) ?? {};

			if (!name) {
				return {
					jsonrpc: '2.0',
					id,
					error: { code: -32602, message: 'tools/call requires `name`' }
				};
			}

			try {
				const result = await dispatchTool(name, args, ctx);
				return { jsonrpc: '2.0', id, result: toolResult(result) };
			} catch (e) {
				const msg = e instanceof Error ? e.message : 'tool execution failed';
				return {
					jsonrpc: '2.0',
					id,
					result: {
						isError: true,
						content: [{ type: 'text', text: msg }]
					}
				};
			}
		}

		default:
			return {
				jsonrpc: '2.0',
				id,
				error: { code: -32601, message: `Unknown method: ${method}` }
			};
	}
}

async function dispatchTool(
	name: string,
	args: Record<string, unknown>,
	ctx: { fetch: typeof fetch; authHeader: string }
): Promise<unknown> {
	const { fetch: f, authHeader } = ctx;

	switch (name) {
		case 'list_workspaces':
			return callApi(f, authHeader, 'GET', '/api/mcp/workspaces');

		case 'list_projects': {
			const wsId = asString(args.workspace_id);
			if (!wsId) {
				throw new Error('list_projects: workspace_id is required');
			}
			const kind = asString(args.kind);
			const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
			return callApi(f, authHeader, 'GET', `/api/mcp/workspaces/${wsId}/projects${qs}`);
		}

		case 'create_whiteboard_project': {
			const wsId = asString(args.workspace_id);
			const projectName = asString(args.name);
			if (!wsId || !projectName) {
				throw new Error('create_whiteboard_project: workspace_id and name are required');
			}
			return callApi(f, authHeader, 'POST', '/api/mcp/projects', {
				workspace_id: wsId,
				name: projectName,
				kind: 'whiteboard',
				scene: args.scene ?? null
			});
		}

		case 'create_doc_project': {
			const wsId = asString(args.workspace_id);
			const projectName = asString(args.name);
			if (!wsId || !projectName) {
				throw new Error('create_doc_project: workspace_id and name are required');
			}
			return callApi(f, authHeader, 'POST', '/api/mcp/projects', {
				workspace_id: wsId,
				name: projectName,
				kind: 'doc'
			});
		}

		case 'create_todo_project': {
			const wsId = asString(args.workspace_id);
			const projectName = asString(args.name);
			if (!wsId || !projectName) {
				throw new Error('create_todo_project: workspace_id and name are required');
			}
			return callApi(f, authHeader, 'POST', '/api/mcp/projects', {
				workspace_id: wsId,
				name: projectName,
				kind: 'todo'
			});
		}

		case 'create_sheet_project': {
			const wsId = asString(args.workspace_id);
			const projectName = asString(args.name);
			if (!wsId || !projectName) {
				throw new Error('create_sheet_project: workspace_id and name are required');
			}
			return callApi(f, authHeader, 'POST', '/api/mcp/projects', {
				workspace_id: wsId,
				name: projectName,
				kind: 'sheet'
			});
		}

		case 'get_sheet': {
			const projectId = asString(args.project_id);
			if (!projectId) {
				throw new Error('get_sheet: project_id is required');
			}
			return callApi(f, authHeader, 'GET', `/api/mcp/projects/${projectId}/sheet`);
		}

		case 'set_sheet_cells': {
			const projectId = asString(args.project_id);
			if (!projectId) {
				throw new Error('set_sheet_cells: project_id is required');
			}
			if (!Array.isArray(args.cells) || args.cells.length === 0) {
				throw new Error('set_sheet_cells: cells must be a non-empty array of { a1, value }');
			}
			const payload: Record<string, unknown> = { cells: args.cells };
			const sheetId = asString(args.sheet_id);
			if (sheetId) {
				payload.sheet_id = sheetId;
			}
			const sheetName = asString(args.sheet_name);
			if (sheetName) {
				payload.sheet_name = sheetName;
			}
			if (typeof args.create_sheet === 'boolean') {
				payload.create_sheet = args.create_sheet;
			}
			return callApi(f, authHeader, 'PATCH', `/api/mcp/projects/${projectId}/sheet`, payload);
		}

		case 'list_documents': {
			const projectId = asString(args.project_id);
			if (!projectId) {
				throw new Error('list_documents: project_id is required');
			}
			return callApi(f, authHeader, 'GET', `/api/mcp/projects/${projectId}/documents`);
		}

		case 'upload_markdown': {
			const projectId = asString(args.project_id);
			const docName = asString(args.name);
			const content = asString(args.content);
			if (!projectId || !docName) {
				throw new Error('upload_markdown: project_id and name are required');
			}
			return callApi(f, authHeader, 'POST', `/api/mcp/projects/${projectId}/documents`, {
				name: docName,
				content: content ?? ''
			});
		}

		case 'update_markdown': {
			const docId = asString(args.document_id);
			if (!docId) {
				throw new Error('update_markdown: document_id is required');
			}
			const content = asString(args.content);
			const name = asString(args.name);
			if (content === null && name === null) {
				throw new Error('update_markdown: pass at least one of `content` or `name`');
			}
			const payload: Record<string, string> = {};
			if (content !== null) {
				payload.content = content;
			}
			if (name !== null) {
				payload.name = name;
			}
			return callApi(f, authHeader, 'PATCH', `/api/mcp/documents/${docId}`, payload);
		}

		case 'get_document_comments': {
			const docId = asString(args.document_id);
			if (!docId) {
				throw new Error('get_document_comments: document_id is required');
			}
			const params = new URLSearchParams();
			const quote = asString(args.quote);
			if (quote) {
				params.set('quote', quote);
			}
			const startN = asFiniteNumber(args.start);
			const endN = asFiniteNumber(args.end);
			if (startN !== null) {
				params.set('start', String(startN));
			}
			if (endN !== null) {
				params.set('end', String(endN));
			}
			const qs = params.toString();
			return callApi(
				f,
				authHeader,
				'GET',
				`/api/mcp/documents/${docId}/comments${qs ? `?${qs}` : ''}`
			);
		}

		case 'get_project_comments': {
			const projectId = asString(args.project_id);
			if (!projectId) {
				throw new Error('get_project_comments: project_id is required');
			}
			const params = new URLSearchParams();
			const state = asString(args.state);
			if (state === 'open' || state === 'resolved' || state === 'all') {
				params.set('state', state);
			}
			const docFilter = asString(args.document_id);
			if (docFilter) {
				params.set('document_id', docFilter);
			}
			const qs = params.toString();
			return callApi(
				f,
				authHeader,
				'GET',
				`/api/mcp/projects/${projectId}/comments${qs ? `?${qs}` : ''}`
			);
		}

		case 'reply_to_comment': {
			const commentId = asString(args.comment_id);
			const body = asString(args.body);
			if (!commentId || !body) {
				throw new Error('reply_to_comment: comment_id and body are required');
			}
			return callApi(f, authHeader, 'POST', `/api/mcp/comments/${commentId}/replies`, {
				body
			});
		}

		case 'resolve_comment': {
			const commentId = asString(args.comment_id);
			if (!commentId) {
				throw new Error('resolve_comment: comment_id is required');
			}
			// Default to true when arg omitted, but only forward an explicit
			// boolean — leave the body empty if the caller didn't ask.
			const payload =
				typeof args.resolved === 'boolean' ? { resolved: args.resolved } : { resolved: true };
			return callApi(f, authHeader, 'POST', `/api/mcp/comments/${commentId}/resolve`, payload);
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

// --- SvelteKit entrypoints -------------------------------------------------

/**
 * POST /mcp — JSON-RPC over HTTP.
 *
 * Per spec, the request body is either a single JSON-RPC message or a batch
 * (array). We respond accordingly.
 */
export const POST: RequestHandler = async ({ request, fetch, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const authHeader = request.headers.get('authorization') ?? '';
	if (!authHeader.startsWith('Bearer ')) {
		throw error(401, 'Bearer token required');
	}

	const raw: unknown = await request.json().catch(() => null);
	if (raw === null) {
		throw error(400, 'Invalid JSON');
	}

	const ctx = { fetch, authHeader };

	if (Array.isArray(raw)) {
		// Batch request — process each, collect non-null responses.
		const responses: JsonRpcResponse[] = [];
		for (const item of raw) {
			const itemRecord = toRecord(item);
			if (itemRecord) {
				const r = await handle(itemRecord, ctx);
				if (r) {
					responses.push(r);
				}
			}
		}
		return responses.length > 0 ? json(responses) : new Response(null, { status: 204 });
	}

	const rawRecord = toRecord(raw);
	if (!rawRecord) {
		throw error(400, 'Body must be a JSON-RPC message or batch');
	}

	const response = await handle(rawRecord, ctx);
	return response ? json(response) : new Response(null, { status: 204 });
};

/**
 * GET /mcp — health probe.
 *
 * Streamable HTTP also defines GET as an SSE channel for server-initiated
 * messages, but we don't push anything (no subscriptions, no notifications),
 * so just returning a 200 with a tiny "ready" JSON makes the endpoint
 * curl-friendly for debugging without breaking spec-compliant clients.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	return json({ ok: true, server: 'mindspace', protocolVersion: PROTOCOL_VERSION });
};
