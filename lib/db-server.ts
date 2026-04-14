import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.resolve(process.cwd(), "server", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, "menu.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    invite_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ingredients TEXT,
    steps TEXT,
    tips TEXT,
    shop TEXT,
    shop_address TEXT,
    image_url TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS combo_templates (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rules TEXT NOT NULL DEFAULT '[]',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS change_logs (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    profile_id TEXT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    before_snapshot TEXT,
    after_snapshot TEXT,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_change_logs_space ON change_logs(space_id);
  CREATE INDEX IF NOT EXISTS idx_change_logs_record ON change_logs(table_name, record_id);
`);

function dropCrudTriggers(table: string) {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_${table}_insert;
    DROP TRIGGER IF EXISTS trg_${table}_update;
    DROP TRIGGER IF EXISTS trg_${table}_delete;
  `);
}

function recreateMenuItemsTableWithoutWeight(includeImageUrl: boolean) {
  const selectImageUrl = includeImageUrl ? "image_url" : "NULL";
  const migrate = db.transaction(() => {
    dropCrudTriggers("menu_items");
    db.exec(`ALTER TABLE menu_items RENAME TO menu_items_legacy`);
    db.exec(`
      CREATE TABLE menu_items (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ingredients TEXT,
        steps TEXT,
        tips TEXT,
        shop TEXT,
        shop_address TEXT,
        image_url TEXT,
        version INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.exec(`
      INSERT INTO menu_items (
        id, space_id, profile_id, kind, name, tags, created_at, updated_at,
        ingredients, steps, tips, shop, shop_address, image_url, version
      )
      SELECT
        id, space_id, profile_id, kind, name, tags, created_at, updated_at,
        ingredients, steps, tips, shop, shop_address, ${selectImageUrl}, version
      FROM menu_items_legacy
    `);
    db.exec(`DROP TABLE menu_items_legacy`);
  });
  migrate();
}

// Migration: strip legacy shared weight column and ensure image_url exists
const menuItemsColumns = db.prepare("PRAGMA table_info(menu_items)").all() as { name: string }[];
const hasLegacyWeight = menuItemsColumns.some((c) => c.name === "weight");
const hasImageUrl = menuItemsColumns.some((c) => c.name === "image_url");

if (hasLegacyWeight) {
  recreateMenuItemsTableWithoutWeight(hasImageUrl);
} else if (!hasImageUrl) {
  db.exec(`ALTER TABLE menu_items ADD COLUMN image_url TEXT`);
  dropCrudTriggers("menu_items");
}

// Triggers for menu_items
function createTrigger(table: string) {
  const beforeInsert = `
    CREATE TRIGGER IF NOT EXISTS trg_${table}_insert
    AFTER INSERT ON ${table}
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        '${table}',
        NEW.id,
        'create',
        NULL,
        json_object(
          'id', NEW.id,
          'spaceId', NEW.space_id,
          'profileId', NEW.profile_id,
          'kind', NEW.kind,
          'name', NEW.name,
          'tags', NEW.tags,
          'createdAt', NEW.created_at,
          'updatedAt', NEW.updated_at,
          'ingredients', NEW.ingredients,
          'steps', NEW.steps,
          'tips', NEW.tips,
          'shop', NEW.shop,
          'shopAddress', NEW.shop_address,
          'imageUrl', NEW.image_url,
          'version', NEW.version
        ),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `;

  const beforeUpdate = `
    CREATE TRIGGER IF NOT EXISTS trg_${table}_update
    AFTER UPDATE ON ${table}
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        '${table}',
        NEW.id,
        'update',
        json_object(
          'id', OLD.id,
          'spaceId', OLD.space_id,
          'profileId', OLD.profile_id,
          'kind', OLD.kind,
          'name', OLD.name,
          'tags', OLD.tags,
          'createdAt', OLD.created_at,
          'updatedAt', OLD.updated_at,
          'ingredients', OLD.ingredients,
          'steps', OLD.steps,
          'tips', OLD.tips,
          'shop', OLD.shop,
          'shopAddress', OLD.shop_address,
          'imageUrl', OLD.image_url,
          'version', OLD.version
        ),
        json_object(
          'id', NEW.id,
          'spaceId', NEW.space_id,
          'profileId', NEW.profile_id,
          'kind', NEW.kind,
          'name', NEW.name,
          'tags', NEW.tags,
          'createdAt', NEW.created_at,
          'updatedAt', NEW.updated_at,
          'ingredients', NEW.ingredients,
          'steps', NEW.steps,
          'tips', NEW.tips,
          'shop', NEW.shop,
          'shopAddress', NEW.shop_address,
          'imageUrl', NEW.image_url,
          'version', NEW.version
        ),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `;

  const beforeDelete = `
    CREATE TRIGGER IF NOT EXISTS trg_${table}_delete
    AFTER DELETE ON ${table}
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        '${table}',
        OLD.id,
        'delete',
        json_object(
          'id', OLD.id,
          'spaceId', OLD.space_id,
          'profileId', OLD.profile_id,
          'kind', OLD.kind,
          'name', OLD.name,
          'tags', OLD.tags,
          'createdAt', OLD.created_at,
          'updatedAt', OLD.updated_at,
          'ingredients', OLD.ingredients,
          'steps', OLD.steps,
          'tips', OLD.tips,
          'shop', OLD.shop,
          'shopAddress', OLD.shop_address,
          'imageUrl', OLD.image_url,
          'version', OLD.version
        ),
        NULL,
        COALESCE(OLD.version, 1),
        unixepoch() * 1000
      );
    END;
  `;

  db.exec(beforeInsert);
  db.exec(beforeUpdate);
  db.exec(beforeDelete);
}

// Triggers for tags (different columns)
function createTagTrigger() {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_tags_insert
    AFTER INSERT ON tags
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        'tags',
        NEW.id,
        'create',
        NULL,
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'name', NEW.name, 'type', NEW.type, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at, 'version', NEW.version),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_tags_update
    AFTER UPDATE ON tags
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        'tags',
        NEW.id,
        'update',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'name', OLD.name, 'type', OLD.type, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at, 'version', OLD.version),
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'name', NEW.name, 'type', NEW.type, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at, 'version', NEW.version),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_tags_delete
    AFTER DELETE ON tags
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        'tags',
        OLD.id,
        'delete',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'name', OLD.name, 'type', OLD.type, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at, 'version', OLD.version),
        NULL,
        COALESCE(OLD.version, 1),
        unixepoch() * 1000
      );
    END;
  `);
}

// Triggers for combo_templates
function createComboTrigger() {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_combo_templates_insert
    AFTER INSERT ON combo_templates
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        'combo_templates',
        NEW.id,
        'create',
        NULL,
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'name', NEW.name, 'rules', NEW.rules, 'isBuiltin', NEW.is_builtin, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at, 'version', NEW.version),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_combo_templates_update
    AFTER UPDATE ON combo_templates
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        'combo_templates',
        NEW.id,
        'update',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'name', OLD.name, 'rules', OLD.rules, 'isBuiltin', OLD.is_builtin, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at, 'version', OLD.version),
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'name', NEW.name, 'rules', NEW.rules, 'isBuiltin', NEW.is_builtin, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at, 'version', NEW.version),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_combo_templates_delete
    AFTER DELETE ON combo_templates
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        'combo_templates',
        OLD.id,
        'delete',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'name', OLD.name, 'rules', OLD.rules, 'isBuiltin', OLD.is_builtin, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at, 'version', OLD.version),
        NULL,
        COALESCE(OLD.version, 1),
        unixepoch() * 1000
      );
    END;
  `);
}

dropCrudTriggers("menu_items");
dropCrudTriggers("tags");
dropCrudTriggers("combo_templates");
createTrigger("menu_items");
createTagTrigger();
createComboTrigger();
