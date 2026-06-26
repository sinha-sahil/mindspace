#!/usr/bin/env node
/**
 * mindspace MCP server.
 *
 * Exposes tools to an LLM client (Claude Code, Claude Desktop) so it can:
 *   - browse the user's workspaces + projects
 *   - create whiteboard projects (optionally seeded with an Excalidraw scene)
 *   - create doc projects and upload markdown documents
 *   - fetch text-anchored comment threads (optionally by quote or range)
 *
 * Auth: bearer token from MINDSPACE_API_TOKEN. The user creates one at
 * https://www.mindspace.casa/settings/api-tokens and passes it via the env
 * when launching this server.
 *
 * Transport: stdio JSON-RPC (the format Claude Code uses). The server is
 * launched by the client per-session, runs until the client disconnects.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// --- config ----------------------------------------------------------------

const API_BASE = (process.env.MINDSPACE_API_URL ?? 'https://www.mindspace.casa').replace(/\/$/, '');
const API_TOKEN = process.env.MINDSPACE_API_TOKEN;

if (!API_TOKEN) {
	process.stderr.write(
		'mindspace-mcp: MINDSPACE_API_TOKEN env var is required.\n' +
			'  Generate a token at ' +
			API_BASE +
			'/settings/api-tokens then set MINDSPACE_API_TOKEN=mind_…\n'
	);
	process.exit(1);
}

// --- http client -----------------------------------------------------------

/**
 * Hit the mindspace API with the configured bearer token.
 * Returns the parsed JSON response, or throws an Error with the status +
 * body so the LLM sees a useful message.
 */
async function mindspaceApi(
	method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
	path: string,
	body?: unknown
): Promise<unknown> {
	const url = `${API_BASE}${path}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${API_TOKEN}`,
		Accept: 'application/json'
	};
	const init: RequestInit = { method, headers };
	if (body !== undefined && body !== null) {
		headers['Content-Type'] = 'application/json';
		init.body = JSON.stringify(body);
	}
	const res = await fetch(url, init);
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

function jsonResult(value: unknown) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify(value, null, 2)
			}
		]
	};
}

// --- server + tools --------------------------------------------------------

const server = new McpServer({
	name: 'mindspace',
	version: '0.1.0'
});

server.registerTool(
	'list_workspaces',
	{
		title: 'List Workspaces',
		description:
			'List the workspaces this token can access. Returns id, name, role (owner | editor | viewer), and created_at. Call this first to discover which workspace_id to pass to other tools.',
		inputSchema: {}
	},
	async () => jsonResult(await mindspaceApi('GET', '/api/mcp/workspaces'))
);

server.registerTool(
	'list_projects',
	{
		title: 'List Projects',
		description:
			'List projects in a workspace. Optional kind filter ("whiteboard", "doc", "todo", or "sheet") narrows the result. Each project has id, name, kind, visibility, created_at, updated_at.',
		inputSchema: {
			workspace_id: z.string().uuid().describe('UUID of the workspace, from list_workspaces.'),
			kind: z
				.enum(['whiteboard', 'doc', 'todo', 'sheet'])
				.optional()
				.describe('Filter by kind. Omit to get all.')
		}
	},
	async ({ workspace_id, kind }) => {
		const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
		return jsonResult(
			await mindspaceApi('GET', `/api/mcp/workspaces/${workspace_id}/projects${qs}`)
		);
	}
);

server.registerTool(
	'create_whiteboard_project',
	{
		title: 'Create Whiteboard Project',
		description:
			"Create a new whiteboard project in a workspace, optionally seeded with an Excalidraw scene. Scene shape: { elements: ExcalidrawElement[], appState?: object, files?: object }. Each element needs at least { id, type, x, y, width, height, ... } — see Excalidraw docs for the full schema. Common types: 'rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'freedraw'.",
		inputSchema: {
			workspace_id: z.string().uuid().describe('UUID of the destination workspace.'),
			name: z.string().min(1).max(120).describe('Display name for the project.'),
			scene: z
				.unknown()
				.optional()
				.describe(
					'Optional Excalidraw scene JSON. If omitted the canvas opens empty for the user to draw on.'
				)
		}
	},
	async ({ workspace_id, name, scene }) =>
		jsonResult(
			await mindspaceApi('POST', '/api/mcp/projects', {
				workspace_id,
				name,
				kind: 'whiteboard',
				scene: scene ?? null
			})
		)
);

server.registerTool(
	'create_doc_project',
	{
		title: 'Create Doc Project',
		description:
			'Create a new doc project (a folder for markdown documents). Use upload_markdown afterwards to add files to it.',
		inputSchema: {
			workspace_id: z.string().uuid().describe('UUID of the destination workspace.'),
			name: z.string().min(1).max(120).describe('Display name for the project.')
		}
	},
	async ({ workspace_id, name }) =>
		jsonResult(
			await mindspaceApi('POST', '/api/mcp/projects', {
				workspace_id,
				name,
				kind: 'doc'
			})
		)
);

server.registerTool(
	'create_todo_project',
	{
		title: 'Create Todo List Project',
		description:
			'Create a new todo-list project: nested checkboxes grouped into sections and arranged across one or more columns. Opens with a starter column for the user to fill in.',
		inputSchema: {
			workspace_id: z.string().uuid().describe('UUID of the destination workspace.'),
			name: z.string().min(1).max(120).describe('Display name for the project.')
		}
	},
	async ({ workspace_id, name }) =>
		jsonResult(
			await mindspaceApi('POST', '/api/mcp/projects', {
				workspace_id,
				name,
				kind: 'todo'
			})
		)
);

server.registerTool(
	'create_sheet_project',
	{
		title: 'Create Spreadsheet Project',
		description:
			'Create a new spreadsheet project: a workbook of cells with formulas, multiple tabs, and formatting. Opens with one empty "Sheet1". Use set_sheet_cells afterwards to populate it, and get_sheet to read it back with computed values.',
		inputSchema: {
			workspace_id: z.string().uuid().describe('UUID of the destination workspace.'),
			name: z.string().min(1).max(120).describe('Display name for the project.')
		}
	},
	async ({ workspace_id, name }) =>
		jsonResult(
			await mindspaceApi('POST', '/api/mcp/projects', {
				workspace_id,
				name,
				kind: 'sheet'
			})
		)
);

server.registerTool(
	'get_sheet',
	{
		title: 'Read Spreadsheet',
		description:
			'Read every tab of a spreadsheet project. Returns each sheet with its id, name, grid size, and a map of non-empty cells keyed by A1 address — each cell carries its raw `value` (a literal or "=formula"), the engine-`computed` value, and a formatted `display` string. Use this to inspect results before or after writing.',
		inputSchema: {
			project_id: z.string().uuid().describe('UUID of a kind="sheet" project.')
		}
	},
	async ({ project_id }) =>
		jsonResult(await mindspaceApi('GET', `/api/mcp/projects/${project_id}/sheet`))
);

server.registerTool(
	'set_sheet_cells',
	{
		title: 'Write Spreadsheet Cells',
		description:
			'Write raw inputs to cells of a spreadsheet by A1 address. Each cell `value` is a literal ("hello", "42", "3.14", "TRUE") or a formula beginning with "=" (e.g. "=SUM(A1:A10)", "=B2*1.2", "=VLOOKUP(...)"). An empty value clears the cell. Targets the active tab by default; pass sheet_id or sheet_name to choose another (set create_sheet:true to add a new named tab). Returns the updated sheet with recomputed values.',
		inputSchema: {
			project_id: z.string().uuid().describe('UUID of a kind="sheet" project.'),
			cells: z
				.array(
					z.object({
						a1: z.string().describe('Cell address, e.g. "A1", "B12", "AA3".'),
						value: z.string().describe('Literal or "=formula". Empty string clears the cell.')
					})
				)
				.min(1)
				.describe('The cells to write.'),
			sheet_id: z.string().optional().describe('Target tab by id (from get_sheet).'),
			sheet_name: z.string().optional().describe('Target tab by name instead of id.'),
			create_sheet: z
				.boolean()
				.optional()
				.describe('If true and sheet_name does not exist, create it.')
		}
	},
	async ({ project_id, cells, sheet_id, sheet_name, create_sheet }) => {
		const payload: Record<string, unknown> = { cells };
		if (sheet_id !== undefined) {
			payload.sheet_id = sheet_id;
		}
		if (sheet_name !== undefined) {
			payload.sheet_name = sheet_name;
		}
		if (create_sheet !== undefined) {
			payload.create_sheet = create_sheet;
		}
		return jsonResult(
			await mindspaceApi('PATCH', `/api/mcp/projects/${project_id}/sheet`, payload)
		);
	}
);

server.registerTool(
	'list_documents',
	{
		title: 'List Documents',
		description:
			'List markdown documents in a doc project. Returns id, name, content, position, created_at, updated_at for each.',
		inputSchema: {
			project_id: z.string().uuid().describe('UUID of the doc project.')
		}
	},
	async ({ project_id }) =>
		jsonResult(await mindspaceApi('GET', `/api/mcp/projects/${project_id}/documents`))
);

server.registerTool(
	'upload_markdown',
	{
		title: 'Upload Markdown Document',
		description:
			'Create a NEW markdown document inside a doc project. The project must have kind="doc" (use create_doc_project first if needed). For refreshing an existing document, use update_markdown — re-uploading creates a duplicate and orphans the original\'s comment threads.',
		inputSchema: {
			project_id: z.string().uuid().describe('UUID of a kind="doc" project.'),
			name: z.string().min(1).max(200).describe('Document filename, e.g. "ideas.md".'),
			content: z.string().describe('The markdown body. May be empty.')
		}
	},
	async ({ project_id, name, content }) =>
		jsonResult(
			await mindspaceApi('POST', `/api/mcp/projects/${project_id}/documents`, {
				name,
				content
			})
		)
);

server.registerTool(
	'update_markdown',
	{
		title: 'Update Markdown Document In Place',
		description:
			"Replace an existing document's content (and optionally its name) in place. Preserves document_id, project_id, position, created_at, and every attached comment thread — the canonical use for pushing fresh source into mindspace after editing externally. Anchors are not rewritten server-side; the frontend renderer handles drift via a prefix+quote+suffix fallback, so a thread whose quoted text still appears anywhere in the updated document remains visible. Threads whose quote no longer appears at all stay attached but lose their visual highlight until a reader points them back. Editor access required.",
		inputSchema: {
			document_id: z.string().uuid().describe('UUID of the document to update.'),
			content: z.string().optional().describe('New markdown body. Omit to update only the name.'),
			name: z.string().min(1).max(200).optional().describe('New filename. Omit to leave unchanged.')
		}
	},
	async ({ document_id, content, name }) => {
		if (content === undefined && name === undefined) {
			throw new Error('update_markdown: pass at least one of `content` or `name`');
		}
		const payload: Record<string, string> = {};
		if (content !== undefined) {
			payload.content = content;
		}
		if (name !== undefined) {
			payload.name = name;
		}
		return jsonResult(await mindspaceApi('PATCH', `/api/mcp/documents/${document_id}`, payload));
	}
);

server.registerTool(
	'get_document_comments',
	{
		title: 'Get Document Comments',
		description:
			'Fetch text-anchored comment threads on a single document. Without filters, returns every comment. Pass `quote` to match threads by exact selected text. Pass `start` + `end` (plain-text character offsets) to find threads whose anchor range overlaps. Each comment includes parent_id (null for thread roots, root id for replies), body, anchor fields, author_email, created_at, and resolution fields (resolved_at, resolved_by, resolved_by_email).',
		inputSchema: {
			document_id: z.string().uuid().describe('UUID of the document.'),
			quote: z
				.string()
				.optional()
				.describe('Optional: match thread roots with this exact selection.'),
			start: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe('Optional: plain-text start offset for range-overlap matching.'),
			end: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe('Optional: plain-text end offset for range-overlap matching.')
		}
	},
	async ({ document_id, quote, start, end }) => {
		const params = new URLSearchParams();
		if (typeof quote === 'string' && quote.length > 0) {
			params.set('quote', quote);
		}
		if (typeof start === 'number') {
			params.set('start', String(start));
		}
		if (typeof end === 'number') {
			params.set('end', String(end));
		}
		const qs = params.toString();
		return jsonResult(
			await mindspaceApi('GET', `/api/mcp/documents/${document_id}/comments${qs ? `?${qs}` : ''}`)
		);
	}
);

server.registerTool(
	'get_project_comments',
	{
		title: 'Get All Project Comments',
		description:
			'Fetch every comment across every document in a project in one call — ideal for triaging open conversations. Each comment carries its document_id, so the caller can group by file. Optional `state` filters thread roots by resolution status (replies for matching roots always come along). Optional `document_id` narrows to one document inside the project.',
		inputSchema: {
			project_id: z.string().uuid().describe('UUID of the project.'),
			state: z
				.enum(['open', 'resolved', 'all'])
				.optional()
				.describe('Filter thread roots by resolution state. Defaults to "all".'),
			document_id: z
				.string()
				.uuid()
				.optional()
				.describe('Optional: narrow to one document within the project.')
		}
	},
	async ({ project_id, state, document_id }) => {
		const params = new URLSearchParams();
		if (state) {
			params.set('state', state);
		}
		if (document_id) {
			params.set('document_id', document_id);
		}
		const qs = params.toString();
		return jsonResult(
			await mindspaceApi('GET', `/api/mcp/projects/${project_id}/comments${qs ? `?${qs}` : ''}`)
		);
	}
);

server.registerTool(
	'reply_to_comment',
	{
		title: 'Reply to Comment Thread',
		description:
			"Post a chat-style reply on a comment thread. `comment_id` must be a thread ROOT (parent_id is null) — passing a reply id is rejected so the LLM cannot accidentally create nested branches. The reply inherits the root's document + anchor; you only supply the message body.",
		inputSchema: {
			comment_id: z.string().uuid().describe('UUID of the thread root comment to reply to.'),
			body: z.string().min(1).describe('Reply text. Markdown is preserved.')
		}
	},
	async ({ comment_id, body }) =>
		jsonResult(await mindspaceApi('POST', `/api/mcp/comments/${comment_id}/replies`, { body }))
);

server.registerTool(
	'resolve_comment',
	{
		title: 'Resolve / Reopen Comment Thread',
		description:
			'Mark a comment thread resolved (default) or reopen it (`resolved: false`). Acts on the thread ROOT — pass the root comment id, not a reply. Resolution is collaborative: any workspace member can toggle the state.',
		inputSchema: {
			comment_id: z.string().uuid().describe('UUID of the thread root.'),
			resolved: z
				.boolean()
				.optional()
				.describe('true (default) marks the thread resolved. false reopens it.')
		}
	},
	async ({ comment_id, resolved }) =>
		jsonResult(
			await mindspaceApi('POST', `/api/mcp/comments/${comment_id}/resolve`, {
				resolved: resolved ?? true
			})
		)
);

// --- start -----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);

// Log start to stderr (stdout is reserved for JSON-RPC over stdio).
process.stderr.write(`mindspace-mcp connected — API base: ${API_BASE}\n`);
