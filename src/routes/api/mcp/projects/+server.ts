import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { userIsWorkspaceEditor } from '$lib/server/mcp-helpers';
import { createEmptyBook, serializeBook } from '$lib/client/modules/sheets/model';
import type { Json, ProjectKind } from '$lib/database.types';

/**
 * POST /api/mcp/projects
 * body: { workspace_id, name, kind?, scene? }
 *
 * Create a project in a workspace the caller can edit. `kind` defaults to
 * 'whiteboard'. `scene` is optional Excalidraw JSON for whiteboards — passes
 * through to projects.scene as JSONB.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const workspaceId =
		'workspace_id' in body && typeof body.workspace_id === 'string' ? body.workspace_id : '';
	if (!workspaceId) {
		throw error(400, 'workspace_id is required');
	}
	const rawName = 'name' in body && typeof body.name === 'string' ? body.name.trim() : '';
	if (!rawName) {
		throw error(400, 'name is required');
	}

	let kind: ProjectKind = 'whiteboard';
	if ('kind' in body && typeof body.kind === 'string') {
		if (
			body.kind === 'whiteboard' ||
			body.kind === 'doc' ||
			body.kind === 'todo' ||
			body.kind === 'sheet'
		) {
			kind = body.kind;
		} else {
			throw error(400, 'kind must be "whiteboard", "doc", "todo", or "sheet"');
		}
	}

	let scene: Json | null = null;
	if ('scene' in body && body.scene !== null) {
		if (kind !== 'whiteboard') {
			throw error(400, 'scene is only valid for whiteboard projects');
		}
		// Round-trip through JSON to type-launder unknown → Json without an
		// assertion. Drops non-JSON-serializable values (functions, NaN, etc).
		try {
			scene = JSON.parse(JSON.stringify(body.scene));
		} catch {
			throw error(400, 'scene must be JSON-serializable');
		}
	}

	// Seed spreadsheets with an empty workbook so their sheet ids are stable from
	// creation — get_sheet/set_sheet_cells can target a tab by id right away
	// instead of getting a fresh random id on each empty read.
	if (kind === 'sheet' && scene === null) {
		scene = JSON.parse(serializeBook(createEmptyBook()));
	}

	const admin = getSupabaseAdmin();
	const allowed = await userIsWorkspaceEditor(admin, locals.user.id, workspaceId);
	if (!allowed) {
		throw error(403, 'You need editor access to this workspace');
	}

	const { data, error: dbError } = await admin
		.from('projects')
		.insert({
			workspace_id: workspaceId,
			name: rawName,
			kind,
			scene
		})
		.select('id, workspace_id, name, kind, visibility, position, created_at, updated_at')
		.single();

	if (dbError || !data) {
		throw error(500, dbError?.message ?? 'Could not create project');
	}
	return json(data, { status: 201 });
};
