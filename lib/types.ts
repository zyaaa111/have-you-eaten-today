export type MenuItemKind = "recipe" | "takeout";

export interface Ingredient {
  name: string;
  amount?: string;
}

export interface RecipeStep {
  order: number;
  description: string;
  durationMinutes?: number;
}

export type SyncStatus = "local" | "synced" | "pending" | "conflict";

export interface MenuItem {
  id: string;
  kind: MenuItemKind;
  name: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;

  // recipe
  ingredients?: Ingredient[];
  steps?: RecipeStep[];
  tips?: string;

  // takeout
  shop?: string;
  shopAddress?: string;

  // image
  imageUrl?: string;

  // sync / multi-user
  spaceId?: string;
  profileId?: string;
  remoteId?: string;
  syncStatus?: SyncStatus;
  version?: number;
}

export type TagType = "cuisine" | "category" | "custom";

export interface Tag {
  id: string;
  name: string;
  type: TagType;
  createdAt: number;
  updatedAt?: number;

  // sync / multi-user
  spaceId?: string;
  profileId?: string;
  remoteId?: string;
  syncStatus?: SyncStatus;
  version?: number;
}

export interface RolledItem {
  menuItemId: string;
  name: string;
  kind: MenuItemKind;
  shop?: string;
}

export interface RollHistory {
  id: string;
  rolledAt: number;
  items: RolledItem[];
  ruleSnapshot: string;
  ignoredDedup?: boolean;
}

export interface ComboRule {
  count: number;
  kind?: MenuItemKind;
  tagIds?: string[];
  shop?: string;
}

export interface ComboTemplate {
  id: string;
  name: string;
  rules: ComboRule[];
  isBuiltin: boolean;
  createdAt: number;
  updatedAt?: number;

  // sync / multi-user
  spaceId?: string;
  profileId?: string;
  remoteId?: string;
  syncStatus?: SyncStatus;
  version?: number;
}

export interface AppSettings {
  defaultDedupDays: number;
  dedupEnabled: boolean;
  theme: "default" | "dark" | "scrapbook";
}

export interface Space {
  id: string;
  inviteCode: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Profile {
  id: string;
  spaceId: string;
  nickname: string;
  joinedAt: number;
}

export type ChangeLogOperation = "create" | "update" | "delete";

export interface ChangeLog {
  id: string;
  spaceId: string;
  profileId: string;
  actorNickname?: string | null;
  tableName: "menu_items" | "tags" | "combo_templates" | "likes" | "comments";
  recordId: string;
  operation: ChangeLogOperation;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  version: number;
  createdAt: number;
}

export interface Like {
  id: string;
  menuItemId: string;
  profileId: string;
  spaceId?: string;
  createdAt: number;
  syncStatus?: SyncStatus;
  version?: number;
}

export interface Comment {
  id: string;
  menuItemId: string;
  profileId: string;
  spaceId?: string;
  nickname: string;
  content: string;
  isAnonymous: boolean;
  createdAt: number;
  updatedAt?: number;
  syncStatus?: SyncStatus;
  version?: number;
}

export interface PersonalWeight {
  id?: number;
  menuItemId: string;
  weight: number;
}

export interface AppExport {
  schemaVersion: string;
  exportedAt: number;
  appVersion: string;
  data: {
    tags: Tag[];
    menuItems: MenuItem[];
    comboTemplates: ComboTemplate[];
    rollHistory: RollHistory[];
    personalWeights?: PersonalWeight[];
  };
}
