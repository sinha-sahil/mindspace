/**
 * Release changelog shown by the "What's new" announcer.
 *
 * Keep entries newest-first. `id` must be stable and unique — it's the key
 * stored in localStorage to remember what a user has already seen, so never
 * reuse or reorder ids. ISO dates work well.
 *
 * When you ship a feature, add a new entry at the TOP.
 */

import type { IconName } from '$lib/client/components/Icon.svelte';

export type ChangelogFeature = {
	/** Icon name from $lib/client/components/Icon (optional). */
	icon?: IconName;
	title: string;
	description: string;
};

export type Release = {
	/** Stable unique id + sort key. Newer = earlier in the array. */
	id: string;
	/** Human-friendly date label, e.g. "May 2026". */
	date: string;
	/** Short headline for the release. */
	title: string;
	features: ChangelogFeature[];
};

export const CHANGELOG: Release[] = [
	{
		id: '2026-06-23-priority-fire',
		date: 'June 2026',
		title: 'Priority, on fire 🔥',
		features: [
			{
				icon: 'sparkles',
				title: 'Burning priority rating',
				description:
					'To-dos (and whole lists) now have a priority rating shown as flames — one flame for low, three for burning hot. Click the 🔥 chip on a task to set it, then Sort → Priority to float the most on-fire items to the top.'
			}
		]
	},
	{
		id: '2026-06-22-ticket-ratings',
		date: 'June 2026',
		title: 'Effort & time on every to-do',
		features: [
			{
				icon: 'hash',
				title: 'Rate effort and time',
				description:
					'Each to-do now carries an effort and a time estimate (low / medium / high). Click the little E and T chips on a task to set them — handy for sizing work like tickets.'
			},
			{
				icon: 'list',
				title: 'Sort the heavy ones to the top',
				description:
					"Sort any board by Effort or Time to float the biggest items up, or hide completed tasks with one toggle. It's a view — your manual order is kept underneath, and the choice is remembered per board."
			}
		]
	},
	{
		id: '2026-06-22-todo-canvas',
		date: 'June 2026',
		title: 'To-do lists on an infinite canvas',
		features: [
			{
				icon: 'list',
				title: 'Nested to-do lists',
				description:
					'A new kind of project: checklists with checkboxes, section headings, and to-dos you can nest as deep as you like. Hit "+ New project" in the sidebar and pick "Todo list". Enter adds a sibling, Tab / Shift+Tab nest and un-nest, ⌘/Ctrl+Enter ticks an item, and checking a parent ticks everything under it.'
			},
			{
				icon: 'grip',
				title: 'Arrange them on a free canvas',
				description:
					'Each list is a card you can drag anywhere on an infinite canvas — pan by dragging the background or scrolling, and ⌘/Ctrl+scroll (or the zoom controls) to zoom. Your layout and view are saved, and shared links open to the same arrangement.'
			}
		]
	},
	{
		id: '2026-05-26-mcp-update',
		date: 'May 2026',
		title: 'Push fresh source into mindspace',
		features: [
			{
				icon: 'undo',
				title: 'In-place document updates',
				description:
					'New MCP tool replaces a document\'s content (and optionally its name) without orphaning comments. Threads stay attached and the renderer\'s prefix+quote+suffix fallback keeps highlights pointing at the right text wherever it still appears in the updated document. Closes the loop for "edit source → sync into mindspace → reviewer sees the update next to their resolved comments".'
			}
		]
	},
	{
		id: '2026-05-26-mcp-comments',
		date: 'May 2026',
		title: 'LLM-driven comment triage',
		features: [
			{
				icon: 'mail',
				title: 'Project-wide comment fetch',
				description:
					'New MCP tool pulls every comment thread across every document in a project in one call — filterable by open / resolved — so an LLM can triage a whole doc set without paging file-by-file.'
			},
			{
				icon: 'check',
				title: 'Reply & resolve from Claude',
				description:
					'Two new MCP actions: post a chat-style reply on any thread, and mark threads resolved (or reopen them). Resolution is collaborative — any workspace member can toggle it.'
			}
		]
	},
	{
		id: '2026-05-26-mcp-http',
		date: 'May 2026',
		title: 'Drive mindspace from Claude Code',
		features: [
			{
				icon: 'command',
				title: 'Hosted MCP server — no install',
				description:
					'One command in Claude Code points at mindspace.casa/mcp and the LLM can list your workspaces, create whiteboards from Excalidraw scenes, upload markdown, and pull comment threads. Nothing to build or run locally. Click the ⌘ icon at the bottom of the sidebar for the snippet.'
			},
			{
				icon: 'key',
				title: 'API tokens in settings',
				description:
					'Generate long-lived bearer tokens at Settings → API tokens. Each acts as your user, only its sha256 hash is stored, and you can revoke at any time.'
			}
		]
	},
	{
		id: '2026-05-26-docs-and-chats',
		date: 'May 2026',
		title: 'Markdown docs with chat threads',
		features: [
			{
				icon: 'pencil',
				title: 'Doc projects',
				description:
					'A new kind of project that holds a set of markdown documents. Click "+ New project" in the sidebar and pick "Document" — or upload a .md file straight into the project.'
			},
			{
				icon: 'mail',
				title: 'Chats anchored to any text',
				description:
					'Select any text in a document and start a thread. Replies are chat-style with author + timestamp. Click an existing highlight to focus its thread in the side panel.'
			}
		]
	},
	{
		id: '2026-05-22-split-screen',
		date: 'May 2026',
		title: 'Split-screen editing',
		features: [
			{
				icon: 'sidebar',
				title: 'Two projects, side by side',
				description:
					'Open a second project in a split pane and work across both at once. Hit “Split view” in the toolbar, or right-click any project in the sidebar.'
			},
			{
				icon: 'grip',
				title: 'Resizable panes',
				description:
					'Drag the divider to give either project more room — your split ratio is remembered.'
			}
		]
	},
	{
		id: '2026-05-11-multiplayer',
		date: 'May 2026',
		title: 'Real-time multiplayer',
		features: [
			{
				icon: 'sparkles',
				title: 'Live cursors & editing',
				description:
					'See collaborators’ cursors and watch their edits stream onto the canvas as they happen.'
			}
		]
	},
	{
		id: '2026-05-10-shared-workspaces',
		date: 'May 2026',
		title: 'Shared workspaces',
		features: [
			{
				icon: 'shield',
				title: 'Share with editor & viewer roles',
				description:
					'Invite teammates to a workspace from its settings — as full editors or read-only viewers.'
			}
		]
	}
];

export function latestReleaseId(): string {
	return CHANGELOG[0]?.id ?? '';
}
