import { db } from "./db-server";

export type SyncTable = "menu_items" | "tags" | "combo_templates";

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

export function mapRows(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const c = toCamelCase(r);
    if (typeof c.tags === "string") c.tags = JSON.parse(c.tags);
    if (typeof c.ingredients === "string" && c.ingredients) c.ingredients = JSON.parse(c.ingredients);
    if (typeof c.steps === "string" && c.steps) c.steps = JSON.parse(c.steps);
    if (typeof c.rules === "string" && c.rules) c.rules = JSON.parse(c.rules);
    if (c.isBuiltin !== undefined) c.isBuiltin = Boolean(c.isBuiltin);
    return c;
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
  return mapRows(rows);
}

export function pushTable(table: SyncTable, items: Record<string, unknown>[]) {
  const stmt = buildUpsertStatement(table);
  const upsert = db.transaction((rows: Record<string, unknown>[]) => {
    for (const item of rows) {
      const s = toSnakeCase(item);
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

export function deleteFromTable(table: SyncTable, ids: string[], spaceId: string) {
  const placeholders = ids.map(() => "?").join(",");
  const stmt = db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders}) AND space_id = ?`);
  stmt.run(...ids, spaceId);
}
