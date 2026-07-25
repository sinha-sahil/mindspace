import type { IconName } from '$lib/client/components/Icon.svelte';
import type { ProjectKind } from './store.svelte';

/**
 * The single kind→icon mapping. Sidebar rows, the collapsed rail, the command
 * palette, and the new-project menu must all read from here — one object per
 * concept, one icon per object (docs/design.md).
 */
export const KIND_ICONS: Record<ProjectKind, IconName> = {
	doc: 'pencil',
	todo: 'list-checks',
	sheet: 'table',
	whiteboard: 'layout'
};
