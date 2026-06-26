import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase-admin';
import { projectWorkspaceForReader, projectWorkspaceForEditor } from '$lib/server/mcp-helpers';
import {
	normalizeBook,
	serializeBook,
	getSheet,
	parseKey,
	parseA1,
	toA1,
	setCellRaw,
	addSheet,
	selectSheet,
	MAX_ROWS,
	MAX_COLS,
	type SheetBook,
	type Sheet
} from '$lib/client/modules/sheets/model';
import { Engine, FormulaError, type CellValue } from '$lib/client/modules/sheets/engine';

/**
 * Read / write the cells of a spreadsheet ("sheet") project. The workbook lives
 * in projects.scene (JSONB), so both verbs parse it into the shared SheetBook
 * model, operate on it, and (for writes) serialize it back. Reads return both
 * the raw input and the formula-engine's computed value per cell, keyed by A1,
 * so an LLM sees results without re-implementing the engine.
 */

type JsonValue = number | string | boolean | null;

function valueToJson(v: CellValue): JsonValue {
	if (v instanceof FormulaError) {
		return v.code;
	}
	if (typeof v === 'number') {
		return Number.isFinite(v) ? v : String(v);
	}
	if (v === '') {
		return null;
	}
	return v;
}

/** Serialize a single sheet to an A1-keyed cell map with computed values. */
function serializeSheet(engine: Engine, sheet: Sheet) {
	const cells: Record<string, { value: string; computed: JsonValue; display: string }> = {};
	for (const [key, cell] of Object.entries(sheet.cells)) {
		const pos = parseKey(key);
		if (!pos || (cell.v === '' && !cell.f)) {
			continue;
		}
		const a1 = toA1(pos.row, pos.col);
		const computed = engine.getValue(sheet.id, pos.row, pos.col);
		cells[a1] = {
			value: cell.v,
			computed: valueToJson(computed),
			display: engine.display(sheet.id, pos.row, pos.col)
		};
	}
	return {
		id: sheet.id,
		name: sheet.name,
		rows: sheet.rows,
		cols: sheet.cols,
		cell_count: Object.keys(cells).length,
		cells
	};
}

function loadBook(scene: unknown): SheetBook {
	return normalizeBook(scene ?? null);
}

async function fetchProjectScene(
	admin: ReturnType<typeof getSupabaseAdmin>,
	projectId: string
): Promise<{ scene: unknown; name: string }> {
	const { data, error: dbError } = await admin
		.from('projects')
		.select('scene, name')
		.eq('id', projectId)
		.maybeSingle();
	if (dbError) {
		throw error(500, dbError.message);
	}
	if (!data) {
		throw error(404, 'Project not found');
	}
	return { scene: data.scene, name: data.name };
}

/**
 * GET /api/mcp/projects/[id]/sheet — read every sheet's cells + computed values.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const admin = getSupabaseAdmin();
	const ctx = await projectWorkspaceForReader(admin, locals.user.id, params.id);
	if (ctx.kind !== 'sheet') {
		throw error(400, 'This project is not a spreadsheet (kind must be "sheet")');
	}
	const { scene, name } = await fetchProjectScene(admin, params.id);
	const book = loadBook(scene);
	// A brand-new sheet project has scene=null, so loadBook mints fresh random
	// sheet ids on every read. Persist the workbook once so its ids become a
	// stable handle for set_sheet_cells(sheet_id=…).
	if (scene === null) {
		await admin
			.from('projects')
			.update({ scene: JSON.parse(serializeBook(book)) })
			.eq('id', params.id);
	}
	const engine = new Engine(book);
	return json({
		project_id: params.id,
		name,
		active_sheet_id: book.activeSheetId,
		sheets: book.sheets.map((s) => serializeSheet(engine, s))
	});
};

/**
 * PATCH /api/mcp/projects/[id]/sheet
 * body: {
 *   sheet_id?: string,        // target a tab by id
 *   sheet_name?: string,      // …or by name (created if create_sheet:true)
 *   create_sheet?: boolean,   // create sheet_name if it doesn't exist
 *   cells: { a1: string, value: string }[]  // value "" clears the cell
 * }
 *
 * Writes raw inputs (literals or "=formula") to cells by A1 address, then
 * returns the updated sheet with recomputed values.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.isMember) {
		throw error(401, 'Not authenticated');
	}
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}
	const cellsRaw = 'cells' in body && Array.isArray(body.cells) ? body.cells : null;
	if (!cellsRaw) {
		throw error(400, 'cells must be an array of { a1, value }');
	}

	const admin = getSupabaseAdmin();
	const ctx = await projectWorkspaceForEditor(admin, locals.user.id, params.id);
	if (ctx.kind !== 'sheet') {
		throw error(400, 'This project is not a spreadsheet (kind must be "sheet")');
	}
	const { scene } = await fetchProjectScene(admin, params.id);
	const book = loadBook(scene);

	// Resolve the target sheet.
	const sheetId = 'sheet_id' in body && typeof body.sheet_id === 'string' ? body.sheet_id : null;
	const sheetName =
		'sheet_name' in body && typeof body.sheet_name === 'string' ? body.sheet_name : null;
	const createSheet = 'create_sheet' in body && body.create_sheet === true;

	function resolveTarget(): Sheet {
		if (sheetId) {
			const s = getSheet(book, sheetId);
			if (!s) {
				throw error(404, `No sheet with id "${sheetId}"`);
			}
			return s;
		}
		if (sheetName) {
			const existing = book.sheets.find((s) => s.name.toLowerCase() === sheetName.toLowerCase());
			if (existing) {
				return existing;
			}
			if (!createSheet) {
				throw error(404, `No sheet named "${sheetName}" (pass create_sheet:true to add it)`);
			}
			return addSheet(book, sheetName);
		}
		return getSheet(book, book.activeSheetId) ?? book.sheets[0];
	}
	const target = resolveTarget();
	selectSheet(book, target.id);

	let applied = 0;
	for (const entry of cellsRaw) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const a1 = 'a1' in entry && typeof entry.a1 === 'string' ? entry.a1 : null;
		if (!a1) {
			throw error(400, 'each cell needs an "a1" address, e.g. { "a1": "B2", "value": "=A1*2" }');
		}
		const ref = parseA1(a1);
		if (!ref) {
			throw error(400, `Invalid A1 reference "${a1}"`);
		}
		if (ref.row >= MAX_ROWS || ref.col >= MAX_COLS) {
			throw error(
				400,
				`Cell "${a1}" is outside the maximum grid (${MAX_COLS} columns × ${MAX_ROWS} rows)`
			);
		}
		let value = '';
		if ('value' in entry && entry.value !== null && typeof entry.value !== 'undefined') {
			value = String(entry.value);
		}
		setCellRaw(target, ref.row, ref.col, value);
		applied++;
	}

	const { error: dbError } = await admin
		.from('projects')
		.update({ scene: JSON.parse(serializeBook(book)) })
		.eq('id', params.id);
	if (dbError) {
		throw error(500, dbError.message);
	}

	const engine = new Engine(book);
	return json({
		project_id: params.id,
		applied,
		sheet: serializeSheet(engine, target)
	});
};
