import { db } from "./db-server";
import { sanitizeMenuItemRecord } from "./menu-item-sanitize";
import { buildLikeId } from "./like-id";

export type SyncTable = "menu_items" | "tags" | "combo_templates" | "likes" | "comments";

export function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const sk = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[sk] = v;
  }
  return out;
}

export function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const ck = k.replace(/_([a-z])/g, (_, m) => m.toUpperCase());
    out[ck] = v;
  }
  return out;
}

function sanitizeTableRecord(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  return table === "menu_items" ? sanitizeMenuItemRecord(row) : row;
}

export function mapRows(table: SyncTable, rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const c = toCamelCase(r);
    if (typeof c.tags === "string") c.tags = JSON.parse(c.tags);
    if (typeof c.ingredients === "string" && c.ingredients) c.ingredients = JSON.parse(c.ingredients);
    if (typeof c.steps === "string" && c.steps) c.steps = JSON.parse(c.steps);
    if (typeof c.rules === "string" && c.rules) c.rules = JSON.parse(c.rules);
    if (c.isBuiltin !== undefined) c.isBuiltin = Boolean(c.isBuiltin);
    if (c.isAnonymous !== undefined) c.isAnonymous = Boolean(c.isAnonymous);
    return sanitizeTableRecord(table, c);
  });
}

export function buildUpsertStatement(table: SyncTable) {
  if (table === "menu_items") {
    return db.prepare(`
      INSERT INTO menu_items (id, space_id, profile_id, kind, name, tags, created_at, updated_at, ingredients, steps, tips, shop, shop_address, image_url, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        profile_id = excluded.profile_id,
        kind = excluded.kind,
        name = excluded.name,
        tags = excluded.tags,
        updated_at = excluded.updated_at,
        ingredients = excluded.ingredients,
        steps = excluded.steps,
        tips = excluded.tips,
        shop = excluded.shop,
        shop_address = excluded.shop_address,
        image_url = excluded.image_url,
        version = excluded.version
    `);
  }
  if (table === "tags") {
    return db.prepare(`
      INSERT INTO tags (id, space_id, profile_id, name, type, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        profile_id = excluded.profile_id,
        name = excluded.name,
        type = excluded.type,
        updated_at = excluded.updated_at,
        version = excluded.version
    `);
  }
  if (table === "likes") {
    return db.prepare(`
      INSERT INTO likes (id, menu_item_id, profile_id, space_id, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(menu_item_id, profile_id) DO NOTHING
    `);
  }
  if (table === "comments") {
    return db.prepare(`
      INSERT INTO comments (id, menu_item_id, profile_id, space_id, nickname, content, is_anonymous, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        nickname = excluded.nickname,
        content = excluded.content,
        is_anonymous = excluded.is_anonymous,
        updated_at = excluded.updated_at,
        version = excluded.version
    `);
  }
  return db.prepare(`
    INSERT INTO combo_templates (id, space_id, profile_id, name, rules, is_builtin, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      name = excluded.name,
      rules = excluded.rules,
      is_builtin = excluded.is_builtin,
      updated_at = excluded.updated_at,
      version = excluded.version
  `);
}

export function pullTable(table: SyncTable, spaceId: string) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE space_id = ?`).all(spaceId) as Record<string, unknown>[];
  return mapRows(table, rows);
}

export function pushTable(table: SyncTable, items: Record<string, unknown>[]) {
  const stmt = buildUpsertStatement(table);
  const upsert = db.transaction((rows: Record<string, unknown>[]) => {
    for (const item of rows) {
      const s = toSnakeCase(sanitizeTableRecord(table, item));
      if (table === "menu_items") {
        stmt.run(
          s.id,
          s.space_id,
          s.profile_id,
          s.kind,
          s.name,
          JSON.stringify(s.tags ?? []),
          s.created_at,
          s.updated_at,
          s.ingredients ? JSON.stringify(s.ingredients) : null,
          s.steps ? JSON.stringify(s.steps) : null,
          s.tips ?? null,
          s.shop ?? null,
          s.shop_address ?? null,
          s.image_url ?? null,
          s.version ?? 1
        );
      } else if (table === "tags") {
        stmt.run(
          s.id,
          s.space_id,
          s.profile_id,
          s.name,
          s.type,
          s.created_at,
          s.updated_at ?? null,
          s.version ?? 1
        );
      } else if (table === "likes") {
        const likeId =
          typeof s.space_id === "string" &&
          typeof s.menu_item_id === "string" &&
          typeof s.profile_id === "string"
            ? buildLikeId(s.space_id, s.menu_item_id, s.profile_id)
            : s.id;
        stmt.run(
          likeId,
          s.menu_item_id,
          s.profile_id,
          s.space_id,
          s.created_at
        );
      } else if (table === "comments") {
        stmt.run(
          s.id,
          s.menu_item_id,
          s.profile_id,
          s.space_id,
          s.nickname,
          s.content,
          s.is_anonymous ? 1 : 0,
          s.created_at,
          s.updated_at ?? null,
          s.version ?? 1
        );
      } else {
        stmt.run(
          s.id,
          s.space_id,
          s.profile_id,
          s.name,
          JSON.stringify(s.rules ?? []),
          s.is_builtin ? 1 : 0,
          s.created_at,
          s.updated_at ?? null,
          s.version ?? 1
        );
      }
    }
  });
  upsert(items);
}

export function deleteFromTable(
  table: SyncTable,
  ids: string[],
  spaceId: string
): { deletedIds: string[]; missingIds: string[] } {
  if (ids.length === 0) {
    return { deletedIds: [], missingIds: [] };
  }

  const placeholders = ids.map(() => "?").join(",");
  const selectStmt = db.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders}) AND space_id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders}) AND space_id = ?`);

  const deletedIds = db.transaction(() => {
    const rows = selectStmt.all(...ids, spaceId) as { id: string }[];
    deleteStmt.run(...ids, spaceId);
    return rows.map((row) => row.id);
  })();

  const deletedSet = new Set(deletedIds);
  return {
    deletedIds,
    missingIds: ids.filter((id) => !deletedSet.has(id)),
  };
}
