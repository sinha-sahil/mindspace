# mindspace

**An infinite canvas for the way you actually think.**

A quiet, invite-only thinking space for small teams who'd rather sketch than slide-deck. Built for people who think in shapes and arrows, work across time zones, and want something that feels like a notebook — not enterprise software.

→ **Live at [www.mindspace.casa](https://www.mindspace.casa)** *(invite-only)*

---

## What it does

### Sketch together, in real time
- **Live multiplayer canvas.** See every collaborator's cursor, watch their edits stream in, no refresh needed.
- **Hand-drawn aesthetic.** Excalidraw under the hood — smart shape recognition, rich text, freehand drawing, the lot.
- **Conflict-free editing.** Element-version reconciliation means concurrent edits never overwrite each other.
- **Presence indicators.** A coloured avatar stack at the top of every project shows who's viewing right now.

### Organise without ceremony
- **Workspaces.** Separate spheres of work — Personal, a side project, a client. One owner, many members.
- **Drag to reorder.** Smooth floating-ghost interaction in the sidebar; order syncs across your devices.
- **Right-click context menu.** Rename, make public / private, copy link, move to another workspace, delete.
- **Inline rename.** Click any project title — sidebar or top bar — to edit it in place.
- **Quick switcher.** ⌘K opens a command palette for searching and switching projects.

### Share when you mean to
- **Workspace sharing with roles.** Editor (full access) or Viewer (read-only). Share by email — the picker types-ahead through anyone already on the platform.
- **Public links.** Flip any single project to "Anyone with the link" for a clean read-only viewer. Perfect for dropping a proposal in Slack without handing over the whole workspace.
- **Invite-only platform.** Only emails on the allowlist can sign in. Admins issue invite links with optional expiry and use limits.

### Login that stays out of the way
- **Passkey-first.** Touch ID, Face ID, security keys. No passwords to remember.
- **Magic-link fallback** for first-time sign-in or new devices.
- **One-tap from invite to in-app** — accept the invite, get the link, click, you're in.

### Built for keepers
- **Autosave.** Every edit persists within 500 ms. No "save" buttons.
- **Light, dark, or system theme.** The canvas follows your OS, your mood, or whatever you set.
- **Mobile-friendly.** Collapsible icon rail and touch-aware canvas.
- **Anonymous, opinion-free analytics.** We measure usage to improve the product; we don't track you across the web.

## What it isn't

- **Not Figma.** No vector design pipelines, auto-layout, or design tokens.
- **Not Notion.** No databases, docs, or AI writer.
- **Not Slack.** No chat, channels, or DMs.

It's a space to *think*. The shapes you draw belong to you and the people you trust enough to invite.

## Designed for

- **Small teams** who want one shared whiteboard, not a forest of tabs.
- **Solo thinkers** who keep a "scratch space" between conversations.
- **Designers / engineers / PMs** roughing out architecture, flows, retros, mind maps.
- **Anyone** who'd rather spend their meeting drawing the thing than describing the thing.

---

## On the roadmap

- Comments and @mentions, pinned to canvas regions
- Email digests for workspace activity
- Project version history with one-click restore
- PNG / SVG / PDF export
- Open Graph previews for shared links
- Folders and starred projects

---

## For contributors

SvelteKit + Excalidraw + Supabase + Vercel.

```sh
pnpm install
cp .env.example .env   # fill in your own Supabase project keys
pnpm dev
```

Database schema lives in [`supabase/migrations/`](./supabase/migrations/) — run them in order from the Supabase SQL editor. Architectural notes are in [`plans/`](./plans/).

---

© mindspace · made for slow, deliberate thinking
