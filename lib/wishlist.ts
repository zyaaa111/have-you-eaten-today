import { getSetting, saveSetting } from "./settings";

const WISH_IDS_KEY = "wishIds";

export async function getWishIds(): Promise<string[]> {
  const val = await getSetting<string[]>(WISH_IDS_KEY, []);
  return Array.isArray(val) ? val : [];
}

export async function addWishId(menuItemId: string): Promise<void> {
  const ids = await getWishIds();
  if (!ids.includes(menuItemId)) {
    await saveSetting(WISH_IDS_KEY, [...ids, menuItemId]);
  }
}

export async function removeWishId(menuItemId: string): Promise<void> {
  const ids = await getWishIds();
  await saveSetting(
    WISH_IDS_KEY,
    ids.filter((id) => id !== menuItemId)
  );
}

export async function saveWishIds(ids: string[]): Promise<void> {
  await saveSetting(WISH_IDS_KEY, ids);
}

export async function toggleWishId(menuItemId: string): Promise<boolean> {
  const ids = await getWishIds();
  if (ids.includes(menuItemId)) {
    await removeWishId(menuItemId);
    return false;
  }
  await addWishId(menuItemId);
  return true;
}
