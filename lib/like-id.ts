const LIKE_ID_PREFIX = "like:";

export function buildLikeId(spaceId: string, menuItemId: string, profileId: string): string {
  return `${LIKE_ID_PREFIX}${encodeURIComponent(spaceId)}:${encodeURIComponent(menuItemId)}:${encodeURIComponent(profileId)}`;
}

export function isDeterministicLikeId(id: string): boolean {
  return id.startsWith(LIKE_ID_PREFIX);
}
