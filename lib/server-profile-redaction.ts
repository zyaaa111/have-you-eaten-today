import crypto from "crypto";
import { buildLikeId, isDeterministicLikeId } from "./like-id";
import { db } from "./db-server";

const LEGACY_PROFILE_PREFIX = "legacy-unbound:";

export function buildLegacyProfilePlaceholder(spaceId: string, profileId: string): string {
  const digest = crypto.createHash("sha256").update(`${spaceId}:${profileId}`).digest("hex");
  return `${LEGACY_PROFILE_PREFIX}${digest.slice(0, 24)}`;
}

function collectReferencedProfileIds(value: unknown, out: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencedProfileIds(item, out);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if ((key === "profileId" || key === "profile_id") && typeof nested === "string" && nested) {
      out.add(nested);
      continue;
    }
    collectReferencedProfileIds(nested, out);
  }
}

function getPlaceholderMap(spaceId: string, profileIds: Iterable<string>): Map<string, string> {
  const uniqueProfileIds = Array.from(new Set(Array.from(profileIds).filter(Boolean)));
  if (uniqueProfileIds.length === 0) {
    return new Map();
  }

  const placeholders = uniqueProfileIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT id
     FROM profiles
     WHERE space_id = ?
       AND id IN (${placeholders})
       AND (user_id IS NULL OR user_id = '')`
  ).all(spaceId, ...uniqueProfileIds) as Array<{ id: string }>;

  return new Map(rows.map((row) => [row.id, buildLegacyProfilePlaceholder(spaceId, row.id)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const value = record[camel] ?? record[snake];
  return typeof value === "string" && value ? value : undefined;
}

function writeStringField(record: Record<string, unknown>, camel: string, snake: string, value: string) {
  if (camel in record) {
    record[camel] = value;
  } else if (snake in record) {
    record[snake] = value;
  }
}

function rewriteLikeIdIfNeeded(record: Record<string, unknown>) {
  const profileId = readStringField(record, "profileId", "profile_id");
  const menuItemId = readStringField(record, "menuItemId", "menu_item_id");
  const spaceId = readStringField(record, "spaceId", "space_id");
  if (!profileId || !menuItemId || !spaceId) {
    return;
  }

  const id = readStringField(record, "id", "id");
  if (id && isDeterministicLikeId(id)) {
    record.id = buildLikeId(spaceId, menuItemId, profileId);
  }
}

function rewriteLikeRecordIdIfNeeded(record: Record<string, unknown>) {
  const tableName = readStringField(record, "tableName", "table_name");
  const recordId = readStringField(record, "recordId", "record_id");
  if (tableName !== "likes" || !recordId || !isDeterministicLikeId(recordId)) {
    return;
  }

  const snapshotCandidate =
    (isRecord(record.afterSnapshot) && record.afterSnapshot) ||
    (isRecord(record.after_snapshot) && record.after_snapshot) ||
    (isRecord(record.beforeSnapshot) && record.beforeSnapshot) ||
    (isRecord(record.before_snapshot) && record.before_snapshot);

  if (!snapshotCandidate) {
    return;
  }

  const profileId = readStringField(snapshotCandidate, "profileId", "profile_id");
  const menuItemId = readStringField(snapshotCandidate, "menuItemId", "menu_item_id");
  const spaceId = readStringField(snapshotCandidate, "spaceId", "space_id");
  if (!profileId || !menuItemId || !spaceId) {
    return;
  }

  writeStringField(record, "recordId", "record_id", buildLikeId(spaceId, menuItemId, profileId));
}

function redactValue(value: unknown, placeholderMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, placeholderMap));
  }

  if (!isRecord(value)) {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if ((key === "profileId" || key === "profile_id") && typeof nested === "string" && placeholderMap.has(nested)) {
      next[key] = placeholderMap.get(nested)!;
      continue;
    }
    next[key] = redactValue(nested, placeholderMap);
  }

  rewriteLikeIdIfNeeded(next);
  rewriteLikeRecordIdIfNeeded(next);
  return next;
}

export function redactUnboundProfileReferences<T>(spaceId: string, value: T): T {
  const referencedProfileIds = new Set<string>();
  collectReferencedProfileIds(value, referencedProfileIds);
  const placeholderMap = getPlaceholderMap(spaceId, referencedProfileIds);
  if (placeholderMap.size === 0) {
    return value;
  }
  return redactValue(value, placeholderMap) as T;
}
