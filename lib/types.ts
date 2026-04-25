export type MenuItemKind = "recipe" | "takeout";

export interface Ingredient {
  name: string;
  amount?: string;
  quantity?: number;
  unit?: string;
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
  syncStatus?: SyncStatus;
  version?: number;
}

export interface RolledItem {
  menuItemId: string;
  name: string;
  kind: MenuItemKind;
  shop?: string;
  ingredientSnapshot?: Ingredient[];
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
  userId?: string;
  nickname: string;
  joinedAt: number;
  isAccountBound?: boolean;
}

export interface User {
  id: string;
  email: string;
  createdAt: number;
  hasPassword?: boolean;
}

export interface ProfileMembership {
  profile: Profile;
  space: Space;
}

export interface AuthSession {
  user: User | null;
  profiles: ProfileMembership[];
  passwordResetConfigured?: boolean;
}

export type ChangeLogOperation = "create" | "update" | "delete";

export interface ChangeLog {
  id: string;
  seq?: number;
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

export interface SyncConflict {
  id: string;
  spaceId: string;
  tableName: ChangeLog["tableName"];
  recordId: string;
  localSnapshot: Record<string, unknown> | null;
  remoteSnapshot: Record<string, unknown> | null;
  seq: number;
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
  scope?: "local" | "profile";
  profileId?: string;
  spaceId?: string;
  updatedAt?: number;
}

export interface MenuGroup {
  id: string;
  name: string;
  scope: "local" | "profile";
  profileId?: string;
  spaceId?: string;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
}

export interface MenuGroupItem {
  id?: number;
  groupId: string;
  menuItemId: string;
  profileId?: string;
  spaceId?: string;
  createdAt: number;
  sortOrder: number;
  updatedAt?: number;
}

export interface AppSettingRecord {
  key: string;
  value: unknown;
  updatedAt?: number;
}

export interface AvoidanceRecord {
  id?: number;
  menuItemId: string;
  scope?: "local" | "profile";
  profileId?: string;
  spaceId?: string;
  updatedAt?: number;
}

export interface WishRecord {
  id?: number;
  menuItemId: string;
  scope?: "local" | "profile";
  profileId?: string;
  spaceId?: string;
  updatedAt?: number;
}

export interface FavoriteRecord {
  id?: number;
  menuItemId: string;
  scope?: "local" | "profile";
  profileId?: string;
  spaceId?: string;
  updatedAt?: number;
}

export interface ProfileStateExport {
  settings: AppSettingRecord[];
  avoidances: AvoidanceRecord[];
  wishes: WishRecord[];
  favorites: FavoriteRecord[];
  personalWeights: PersonalWeight[];
  menuGroups: MenuGroup[];
  menuGroupItems: MenuGroupItem[];
  rollHistory: RollHistory[];
}

export interface AppExport {
  schemaVersion: string;
  exportedAt: number;
  appVersion: string;
  data: {
    settings: AppSettingRecord[];
    avoidances: AvoidanceRecord[];
    wishes?: WishRecord[];
    favorites?: FavoriteRecord[];
    tags: Tag[];
    menuItems: MenuItem[];
    comboTemplates: ComboTemplate[];
    rollHistory: RollHistory[];
    personalWeights: PersonalWeight[];
    menuGroups?: MenuGroup[];
    menuGroupItems?: MenuGroupItem[];
    imageFiles?: Record<string, string>;
  };
}
