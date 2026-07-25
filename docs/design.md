# Mono — the mindspace design grammar

Mono is achromatic minimalism (Linear/Vercel canon): chroma-zero neutrals, one
swappable spot accent, semantic status colors, hairlines over shadows. This
file is the contract; `scripts/design-lint.mjs` ratchets drift back out.

## Color

- **Neutrals only** for chrome: `--bg`, `--bg-2`, `--surface`, `--border`,
  `--border-strong`, `--fg`, `--fg-2`, `--muted`. No raw hex in components —
  every color goes through `theme.css` tokens.
- **The accent means _current_**: active sidebar item, selected cell, caret,
  focus ring, selection wash, active Excalidraw tool. It never fills a button
  and never appears "just for color".
- **Status is semantic, not decorative**: `--sage` = success, `--saffron` =
  in-flight, `--rose` = error. A status color always encodes state.
- **No purples, no pinks. Ever.** This includes user-facing default palettes
  (sheet swatches, cursor colors, identity tints) and third-party accents
  (Excalidraw is remapped in `Whiteboard.svelte`).
- **Text contrast floor is AA**: body text uses `--fg`/`--fg-2`/`--muted`.
  `--muted-2` is decorative-only (strokes, glyphs) — it fails 4.5:1.

## Controls

- **Button hierarchy**: primary = inverted neutral (`--fg` on `--bg`);
  secondary = outline; tertiary/icon = ghost (transparent, hover `--bg-2`).
  Destructive = `--rose`. Sizes: 24 / 28 / 34px tall.
- **Icon buttons** are square, ghost, radius `--radius-sm`; sibling utilities
  share one treatment — never mix circle/outline/filled in one cluster.
- **Segmented control** for 2–4 equivalent views (theme toggle, expiry).
  A **menu** for orderings (sort). **Radio-cards** for consequential choices
  that need descriptions (MCP Global/Local).
- **Focus**: never invisible. Components may quiet `:focus`, but the global
  `:focus-visible` ring in `theme.css` always applies to real controls.
- **Disabled** is always `opacity: var(--disabled-opacity)`.

## Structure

- **Radius tokens only**: `--radius-sm(7)` controls · `--radius(9)` cards/
  menus · `--radius-lg(14)` modals · `--radius-pill`. Raw px only for `50%`
  circles and 1–2px hairline nubs.
- **Z-scale**: content 0 · sticky 10 · overlay 100 · modal 200 · toast 300
  (`--z-*`). An overlay owned by another overlay renders inside its owner's
  stacking context with a local z — never a global bid.
- **Motion**: `--t-fast(100ms)` / `--t-slow(180ms)` with `--ease`; every
  animation respects `prefers-reduced-motion` (global guard in theme.css).

## Recurring pieces

- **Section labels** (DOCUMENTS, OUTLINE, THREADS…): mono 10.5px / 600 /
  0.08em / uppercase / `--muted`. One dialect.
- **Kind icons**: `KIND_ICONS` in `modules/projects` is the only
  project-kind→icon mapping — sidebar, palette, and menus all read it.
- **Identity tiles** use muted per-project tints (`TINT_PALETTE`,
  `utils/color.ts`): hue says WHICH project, the kind icon says WHAT it is,
  the accent ring says CURRENT. Tints are desaturated mid-tones applied via
  `--tint` + `color-mix` — never gradients, never saturated fills. The
  workspace tile is inverted neutral; the user avatar is a neutral circle.
  Saturated hues survive only for multiplayer cursors (`CURSOR_PALETTE`).
- **Project bar** is positionable: top tab-bar (default) or left rail —
  user choice in the account menu, `sidebar.barPosition`.
- **Save state**: the shared `SaveState` component only — transient
  "Saving…"/"Saved" flash, nothing at rest. No permanent status dots.
- **Toasts**: the in-house `Toaster` card — editorial solid fills, close
  button, stack cap 3, `role="alert"` for errors.
- **Errors/empties in panels**: icon + tinted panel (`.panel-error` /
  `.inline-error` pattern), never bare red text.
- **Overlays**: Escape and outside-click always dismiss; modals always
  scrim with `--scrim` (ink-based — never fg-based, which inverts in dark).

## Voice

- Relative time speaks one language ("just now", "2m ago").
- Menu items: verb-first, sentence case, consistent object naming
  ("Copy Markdown" / "Download Markdown", never a bare extension).
- All-caps is reserved for section labels — never for content or sections
  inside user data.
