import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { buildLikeId } from "./like-id";

const DATA_DIR = path.resolve(process.cwd(), "server", "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, "menu.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
// Ensure cascade deletes inside triggers do NOT fire inner change_log triggers.
db.pragma("recursive_triggers = OFF");

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
    actor_nickname TEXT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    before_snapshot TEXT,
    after_snapshot TEXT,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    menu_item_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(menu_item_id, profile_id)
  );
  CREATE INDEX IF NOT EXISTS idx_likes_menu_item ON likes(menu_item_id);
  CREATE INDEX IF NOT EXISTS idx_likes_space ON likes(space_id);

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    menu_item_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_comments_menu_item ON comments(menu_item_id);
  CREATE INDEX IF NOT EXISTS idx_comments_space ON comments(space_id);
  CREATE INDEX IF NOT EXISTS idx_comments_profile ON comments(profile_id);

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

const changeLogColumns = db.prepare("PRAGMA table_info(change_logs)").all() as { name: string }[];
if (!changeLogColumns.some((column) => column.name === "actor_nickname")) {
  db.exec(`ALTER TABLE change_logs ADD COLUMN actor_nickname TEXT`);
}

db.exec(`
  UPDATE change_logs
  SET actor_nickname = (
    SELECT nickname
    FROM profiles
    WHERE profiles.id = change_logs.profile_id AND profiles.space_id = change_logs.space_id
    LIMIT 1
  )
  WHERE actor_nickname IS NULL AND profile_id IS NOT NULL
`);

function actorNicknameExpr(profileExpr: string, spaceExpr: string): string {
  return `(SELECT nickname FROM profiles WHERE id = ${profileExpr} AND space_id = ${spaceExpr} LIMIT 1)`;
}

function normalizeLikesTable() {
  const rows = db.prepare(`
    SELECT id, menu_item_id, profile_id, space_id, created_at
    FROM likes
    ORDER BY created_at ASC, id ASC
  `).all() as Array<{
    id: string;
    menu_item_id: string;
    profile_id: string;
    space_id: string;
    created_at: number;
  }>;

  if (rows.length === 0) return;

  const winners = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const canonicalId = buildLikeId(row.space_id, row.menu_item_id, row.profile_id);
    const winner = winners.get(canonicalId);
    if (!winner || preferLikeWinner(row, winner, canonicalId)) {
      winners.set(canonicalId, row);
    }
  }

  const loserIds = rows
    .filter((row) => {
      const canonicalId = buildLikeId(row.space_id, row.menu_item_id, row.profile_id);
      return winners.get(canonicalId)?.id !== row.id;
    })
    .map((row) => row.id);

  db.transaction(() => {
    if (loserIds.length > 0) {
      const placeholders = loserIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM likes WHERE id IN (${placeholders})`).run(...loserIds);
    }

    for (const winner of Array.from(winners.values())) {
      const canonicalId = buildLikeId(winner.space_id, winner.menu_item_id, winner.profile_id);
      if (winner.id === canonicalId) continue;
      db.prepare("UPDATE likes SET id = ? WHERE id = ?").run(canonicalId, winner.id);
    }
  })();
}

function preferLikeWinner(
  candidate: { id: string; created_at: number },
  current: { id: string; created_at: number },
  canonicalId: string
): boolean {
  const candidateCanonical = candidate.id === canonicalId;
  const currentCanonical = current.id === canonicalId;
  if (candidateCanonical !== currentCanonical) {
    return candidateCanonical;
  }
  if (candidate.created_at !== current.created_at) {
    return candidate.created_at < current.created_at;
  }
  return candidate.id < current.id;
}

normalizeLikesTable();

// Triggers for menu_items
function createTrigger(table: string) {
  const actorNicknameNew = actorNicknameExpr("NEW.profile_id", "NEW.space_id");
  const actorNicknameOld = actorNicknameExpr("OLD.profile_id", "OLD.space_id");
  const beforeInsert = `
    CREATE TRIGGER IF NOT EXISTS trg_${table}_insert
    AFTER INSERT ON ${table}
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
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
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
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
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        ${actorNicknameOld},
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
  const actorNicknameNew = actorNicknameExpr("NEW.profile_id", "NEW.space_id");
  const actorNicknameOld = actorNicknameExpr("OLD.profile_id", "OLD.space_id");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_tags_insert
    AFTER INSERT ON tags
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
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
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
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
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        ${actorNicknameOld},
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
  const actorNicknameNew = actorNicknameExpr("NEW.profile_id", "NEW.space_id");
  const actorNicknameOld = actorNicknameExpr("OLD.profile_id", "OLD.space_id");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_combo_templates_insert
    AFTER INSERT ON combo_templates
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
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
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
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
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        ${actorNicknameOld},
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
dropCrudTriggers("likes");
dropCrudTriggers("comments");
createTrigger("menu_items");
createTagTrigger();
createComboTrigger();

// Triggers for likes
function createLikeTrigger() {
  const actorNicknameNew = actorNicknameExpr("NEW.profile_id", "NEW.space_id");
  const actorNicknameOld = actorNicknameExpr("OLD.profile_id", "OLD.space_id");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_likes_insert
    AFTER INSERT ON likes
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
        'likes',
        NEW.id,
        'create',
        NULL,
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'menuItemId', NEW.menu_item_id, 'createdAt', NEW.created_at),
        1,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_likes_delete
    AFTER DELETE ON likes
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        ${actorNicknameOld},
        'likes',
        OLD.id,
        'delete',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'menuItemId', OLD.menu_item_id, 'createdAt', OLD.created_at),
        NULL,
        1,
        unixepoch() * 1000
      );
    END;
  `);
}

// Triggers for comments
function createCommentTrigger() {
  const actorNicknameNew = actorNicknameExpr("NEW.profile_id", "NEW.space_id");
  const actorNicknameOld = actorNicknameExpr("OLD.profile_id", "OLD.space_id");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_comments_insert
    AFTER INSERT ON comments
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
        'comments',
        NEW.id,
        'create',
        NULL,
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'menuItemId', NEW.menu_item_id, 'nickname', NEW.nickname, 'content', NEW.content, 'isAnonymous', NEW.is_anonymous, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at, 'version', NEW.version),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_comments_update
    AFTER UPDATE ON comments
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        NEW.space_id,
        NEW.profile_id,
        ${actorNicknameNew},
        'comments',
        NEW.id,
        'update',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'menuItemId', OLD.menu_item_id, 'nickname', OLD.nickname, 'content', OLD.content, 'isAnonymous', OLD.is_anonymous, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at, 'version', OLD.version),
        json_object('id', NEW.id, 'spaceId', NEW.space_id, 'profileId', NEW.profile_id, 'menuItemId', NEW.menu_item_id, 'nickname', NEW.nickname, 'content', NEW.content, 'isAnonymous', NEW.is_anonymous, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at, 'version', NEW.version),
        NEW.version,
        unixepoch() * 1000
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_comments_delete
    AFTER DELETE ON comments
    BEGIN
      INSERT INTO change_logs (id, space_id, profile_id, actor_nickname, table_name, record_id, operation, before_snapshot, after_snapshot, version, created_at)
      VALUES (
        lower(hex(randomblob(16))),
        OLD.space_id,
        OLD.profile_id,
        ${actorNicknameOld},
        'comments',
        OLD.id,
        'delete',
        json_object('id', OLD.id, 'spaceId', OLD.space_id, 'profileId', OLD.profile_id, 'menuItemId', OLD.menu_item_id, 'nickname', OLD.nickname, 'content', OLD.content, 'isAnonymous', OLD.is_anonymous, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at, 'version', OLD.version),
        NULL,
        COALESCE(OLD.version, 1),
        unixepoch() * 1000
      );
    END;
  `);
}

createLikeTrigger();
createCommentTrigger();

// Cascade delete likes and comments when a menu_item is deleted
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_menu_items_cascade_likes
  AFTER DELETE ON menu_items
  BEGIN
    DELETE FROM likes WHERE menu_item_id = OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS trg_menu_items_cascade_comments
  AFTER DELETE ON menu_items
  BEGIN
    DELETE FROM comments WHERE menu_item_id = OLD.id;
  END;
`);
