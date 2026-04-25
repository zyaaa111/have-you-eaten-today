import { db } from "./db";
import { enrich } from "./space-ops";
import { scheduleProfileStateSync } from "./profile-state";
import { toScopedRecord } from "./private-scope";
import type { MenuItem, PersonalWeight, Tag, TagType } from "./types";
import type { ImportPreview } from "./menu-import-parser";

export interface ImportResult {
  importedCount: number;
  skippedCount: number;
  tagCreatedCount: number;
  errorCount: number;
}

export async function executeImport(preview: ImportPreview): Promise<ImportResult> {
  const now = Date.now();
  const { toImport, skipped, errors, newTags } = preview;

  if (toImport.length === 0) {
    return {
      importedCount: 0,
      skippedCount: skipped.length,
      tagCreatedCount: 0,
      errorCount: errors.length,
    };
  }

  // Step 1: Create new tags and build name→id map
  const tagNameToId = new Map<string, string>();

  // First, load all existing tags to build the map
  const existingTags = await db.tags.toArray();
  for (const tag of existingTags) {
    tagNameToId.set(`${tag.name.toLowerCase()}:${tag.type}`, tag.id);
  }

  // Create new tags
  const tagRecords: Tag[] = [];
  for (const newTag of newTags) {
    const id = crypto.randomUUID();
    const tag: Tag = enrich({
      id,
      name: newTag.name,
      type: newTag.type,
      createdAt: now,
      updatedAt: now,
    });
    tagRecords.push(tag);
    tagNameToId.set(`${newTag.name.toLowerCase()}:${newTag.type}`, id);
  }

  // Step 2: Build menu item records
  const weightedMenuItemIds: string[] = [];
  const personalWeightRecords: PersonalWeight[] = [];
  const menuItemRecords: MenuItem[] = toImport.map((row) => {
    // Resolve tag IDs
    const tagIds: string[] = [];
    for (const type of ["cuisine", "category", "custom"] as TagType[]) {
      for (const tagName of row.tagNamesByType[type]) {
        const lookupKey = `${tagName.toLowerCase()}:${type}`;
        const id = tagNameToId.get(lookupKey);
        if (id) tagIds.push(id);
      }
    }

    const menuItemId = crypto.randomUUID();
    const base: Omit<MenuItem, "spaceId" | "profileId" | "syncStatus" | "version"> & { id: string } = {
      id: menuItemId,
      kind: row.kind,
      name: row.name,
      tags: tagIds,
      createdAt: now,
      updatedAt: now,
    };

    if (row.kind === "recipe") {
      if (row.ingredients.length > 0) base.ingredients = row.ingredients;
      if (row.steps.length > 0) base.steps = row.steps;
      if (row.tips) base.tips = row.tips;
    }

    if (row.kind === "takeout") {
      if (row.shop) base.shop = row.shop;
      if (row.shopAddress) base.shopAddress = row.shopAddress;
    }

    if (row.weight !== 1) {
      weightedMenuItemIds.push(menuItemId);
      personalWeightRecords.push(
        toScopedRecord({
          menuItemId,
          weight: row.weight,
          updatedAt: now,
        })
      );
    }

    return enrich(base);
  });

  // Step 3: Write in a single Dexie transaction
  await db.transaction("rw", [db.tags, db.menuItems, db.personalWeights], async () => {
    if (tagRecords.length > 0) {
      await db.tags.bulkAdd(tagRecords);
    }
    await db.menuItems.bulkAdd(menuItemRecords);
    if (personalWeightRecords.length > 0) {
      await db.personalWeights.bulkAdd(personalWeightRecords);
    }
  });

  if (weightedMenuItemIds.length > 0) {
    scheduleProfileStateSync(
      weightedMenuItemIds.map((id) => ({ collection: "personalWeights" as const, key: id }))
    );
  }

  return {
    importedCount: toImport.length,
    skippedCount: skipped.length,
    tagCreatedCount: tagRecords.length,
    errorCount: errors.length,
  };
}
