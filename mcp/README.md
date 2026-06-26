# mindspace MCP

An [MCP](https://modelcontextprotocol.io) server that gives an LLM client (Claude Code, Claude Desktop, Cursor, …) the ability to drive a [mindspace](https://www.mindspace.casa) workspace — create whiteboard projects (optionally seeded with an Excalidraw scene), spin up doc projects, upload markdown documents, build spreadsheets with formulas, and read back text-anchored comment threads.

> **Most people don't need anything in this directory.** mindspace already hosts the MCP server at `https://www.mindspace.casa/mcp`. The instructions below cover the hosted (HTTP) flow first, and the local stdio binary second for when you need it (local dev, corp networks that block the domain, etc.).

## Tools

| Tool                        | What it does                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `list_workspaces`           | Workspaces this token can access (call this first).                                          |
| `list_projects`             | Projects in a workspace. Optional `kind` filter (`whiteboard` / `doc` / `todo` / `sheet`).   |
| `create_whiteboard_project` | New whiteboard project. Optional Excalidraw `scene` JSON to pre-fill it.                     |
| `create_doc_project`        | New doc project (a folder for markdown documents).                                           |
| `create_todo_project`       | New todo-list project (nested checklists on a canvas).                                       |
| `create_sheet_project`      | New spreadsheet project (a workbook of cells, formulas, and tabs).                           |
| `get_sheet`                 | Read a spreadsheet's tabs + cells with raw input, computed value, and display string.        |
| `set_sheet_cells`           | Write literals or `=formulas` to cells by A1 address; returns the recomputed sheet.          |
| `list_documents`            | Markdown files in a doc project.                                                             |
| `upload_markdown`           | Upload a NEW `.md` file (as `name` + `content`) into a doc project.                          |
| `update_markdown`           | Refresh an existing document in place — preserves comment threads; anchors drift gracefully. |
| `get_document_comments`     | Comment threads on one document — filter by `quote` or character `start`/`end`.              |
| `get_project_comments`      | All comment threads across every document in a project. Filter by `state` (open / resolved). |
| `reply_to_comment`          | Post a chat-style reply on a thread root.                                                    |
| `resolve_comment`           | Mark a thread resolved (or reopen with `resolved: false`).                                   |

## Get a token

1. Sign in to <https://www.mindspace.casa>.
2. Open <https://www.mindspace.casa/settings/api-tokens>.
3. Click **New token**, name it (e.g. "Claude Code · laptop"), copy the raw `mind_…` value shown once.

Tokens act as your user — same workspaces, same permissions. You can revoke at any time.

## Hosted (recommended) — Claude Code

```bash
claude mcp add --transport http mindspace https://www.mindspace.casa/mcp \
  --header "Authorization: Bearer mind_paste_your_token_here"
```

Restart Claude Code. The `mindspace` tools appear immediately. No clone, no build, no local Node process.

## Hosted (recommended) — Claude Desktop / other clients

Add an entry to your client's MCP config (for Claude Desktop, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
	"mcpServers": {
		"mindspace": {
			"type": "http",
			"url": "https://www.mindspace.casa/mcp",
			"headers": {
				"Authorization": "Bearer mind_paste_your_token_here"
			}
		}
	}
}
```

Restart the client.

## Local stdio binary (optional)

Build the stdio binary if you need to run against a local mindspace dev server, are behind a network that can't reach `www.mindspace.casa`, or just prefer running it yourself.

```bash
cd mcp
pnpm install --ignore-workspace
pnpm build
```

That produces `dist/index.js` with a shebang. Then wire it into Claude Code:

```bash
claude mcp add mindspace \
  -e MINDSPACE_API_TOKEN=mind_paste_your_token_here \
  -- node /absolute/path/to/mindspace/mcp/dist/index.js
```

Or hand-edit `~/.claude.json`:

```json
{
	"mcpServers": {
		"mindspace": {
			"command": "node",
			"args": ["/absolute/path/to/mindspace/mcp/dist/index.js"],
			"env": {
				"MINDSPACE_API_TOKEN": "mind_paste_your_token_here"
			}
		}
	}
}
```

Restart Claude Code.

### Environment variables (stdio only)

| Variable              | Required | Default                      | Notes                                                          |
| --------------------- | -------- | ---------------------------- | -------------------------------------------------------------- |
| `MINDSPACE_API_TOKEN` | yes      | —                            | Bearer token from `/settings/api-tokens`. Starts with `mind_`. |
| `MINDSPACE_API_URL`   | no       | `https://www.mindspace.casa` | Override for local dev or a staging deploy.                    |

## Excalidraw scene format

`create_whiteboard_project` accepts a `scene` object that mirrors what Excalidraw exports. Minimum shape:

```json
{
	"elements": [
		{
			"id": "el-1",
			"type": "rectangle",
			"x": 100,
			"y": 100,
			"width": 200,
			"height": 120,
			"strokeColor": "#000",
			"backgroundColor": "transparent"
		}
	],
	"appState": {},
	"files": {}
}
```

See [excalidraw.com/help/json](https://excalidraw.com/) for the full element schema (rectangle / ellipse / arrow / line / text / freedraw / image, with optional binding for connectors). The server passes the scene through to the DB unmodified.

## Quick verify

```bash
curl -H "Authorization: Bearer mind_..." https://www.mindspace.casa/api/mcp/workspaces
```

Should return `{ "workspaces": [...] }`. A `401` means the token is wrong or revoked.

Or hit the MCP endpoint directly with a JSON-RPC `tools/list`:

```bash
curl -X POST -H "Authorization: Bearer mind_..." -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  https://www.mindspace.casa/mcp
```

Should return the full tool list with their JSON-Schema input specs.
