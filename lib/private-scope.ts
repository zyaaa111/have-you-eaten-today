import { getLocalIdentity } from "./identity";
import type {
  AvoidanceRecord,
  FavoriteRecord,
  MenuGroup,
  MenuGroupItem,
  PersonalWeight,
  WishRecord,
} from "./types";

export interface PrivateScope {
  scope: "local" | "profile";
  profileId?: string;
  spaceId?: string;
}

type ScopeAwareRecord = {
  scope?: "local" | "profile";
  profileId?: string;
  spaceId?: string;
};

export function getCurrentPrivateScope(): PrivateScope {
  const identity = getLocalIdentity();
  if (!identity) {
    return { scope: "local" };
  }
  return {
    scope: "profile",
    profileId: identity.profile.id,
    spaceId: identity.space.id,
  };
}

export function isRecordInScope(record: ScopeAwareRecord, scope: PrivateScope): boolean {
  if (scope.scope === "local") {
    return (record.scope ?? "local") === "local";
  }
  return record.scope === "profile" && record.profileId === scope.profileId && record.spaceId === scope.spaceId;
}

export function toScopedRecord<T extends ScopeAwareRecord>(
  record: Omit<T, "scope" | "profileId" | "spaceId">,
  scope = getCurrentPrivateScope()
): T {
  return {
    ...record,
    scope: scope.scope,
    profileId: scope.profileId,
    spaceId: scope.spaceId,
  } as T;
}

export function createScopeMatcher(scope = getCurrentPrivateScope()) {
  return <T extends ScopeAwareRecord>(record: T) => isRecordInScope(record, scope);
}

export function splitLocalPrivateState<T extends ScopeAwareRecord>(records: T[]): T[] {
  return records.filter((record) => (record.scope ?? "local") === "local");
}

export type PrivateRecord =
  | AvoidanceRecord
  | WishRecord
  | FavoriteRecord
  | PersonalWeight
  | MenuGroup
  | MenuGroupItem;
