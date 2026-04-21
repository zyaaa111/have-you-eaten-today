import { buildApiUrl } from "./api-base";
import { db } from "./db";
import { isDataUrlImage } from "./image-utils";

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",", 2);
  const mimeMatch = header?.match(/^data:(.+);base64$/);
  if (!mimeMatch || !payload) {
    throw new Error("无效的图片数据");
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeMatch[1] });
}

export async function uploadMenuItemImage(menuItemId: string, file: Blob): Promise<string> {
  const url = buildApiUrl(`/images/menu-item/${encodeURIComponent(menuItemId)}`);
  const formData = new FormData();
  formData.append("file", file, `${menuItemId}.jpg`);
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const payload = (await response.json()) as { imageUrl?: string };
  if (!payload.imageUrl) {
    throw new Error("图片上传失败");
  }
  return payload.imageUrl;
}

export async function uploadMenuItemImageFromDataUrl(menuItemId: string, dataUrl: string): Promise<string> {
  return uploadMenuItemImage(menuItemId, dataUrlToBlob(dataUrl));
}

export async function removeMenuItemImage(menuItemId: string): Promise<void> {
  const url = buildApiUrl(`/images/menu-item/${encodeURIComponent(menuItemId)}`);
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function fetchImageBlob(imageUrl: string): Promise<Blob> {
  if (isDataUrlImage(imageUrl)) {
    return dataUrlToBlob(imageUrl);
  }
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("图片读取失败");
  }
  return response.blob();
}

export async function migrateLegacyClientImages(): Promise<void> {
  const legacyItems = await db.menuItems
    .filter((item) => isDataUrlImage(item.imageUrl))
    .toArray();

  for (const item of legacyItems) {
    if (!item.imageUrl || !isDataUrlImage(item.imageUrl)) continue;
    const imageUrl = await uploadMenuItemImageFromDataUrl(item.id, item.imageUrl);
    await db.menuItems.update(item.id, {
      imageUrl,
      updatedAt: Date.now(),
      syncStatus: item.spaceId ? "pending" : item.syncStatus ?? "local",
      version: item.spaceId ? (item.version ?? 1) + 1 : item.version ?? 1,
    });
  }
}
