import fs from "fs/promises";
import path from "path";
import { isDataUrlImage } from "./image-utils";

const MENU_ITEM_IMAGE_DIR = path.resolve(process.cwd(), "server", "data", "uploads", "menu-items");

interface StoredImageMeta {
  contentType: string;
}

function getImageBinaryPath(menuItemId: string): string {
  return path.join(MENU_ITEM_IMAGE_DIR, `${menuItemId}.bin`);
}

function getImageMetaPath(menuItemId: string): string {
  return path.join(MENU_ITEM_IMAGE_DIR, `${menuItemId}.json`);
}

async function ensureMenuItemImageDir(): Promise<void> {
  await fs.mkdir(MENU_ITEM_IMAGE_DIR, { recursive: true });
}

export function getMenuItemImagePublicUrl(menuItemId: string): string {
  return `/api/images/menu-item/${menuItemId}`;
}

export function parseDataUrlImage(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("无效的图片 Data URL");
  }
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export async function saveMenuItemImageFile(
  menuItemId: string,
  file: ArrayBuffer | Uint8Array | Buffer,
  contentType = "image/jpeg"
): Promise<string> {
  await ensureMenuItemImageDir();
  const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file instanceof Uint8Array ? file : new Uint8Array(file));
  await Promise.all([
    fs.writeFile(getImageBinaryPath(menuItemId), buffer),
    fs.writeFile(getImageMetaPath(menuItemId), JSON.stringify({ contentType } satisfies StoredImageMeta)),
  ]);
  return getMenuItemImagePublicUrl(menuItemId);
}

export async function saveMenuItemImageDataUrl(menuItemId: string, dataUrl: string): Promise<string> {
  const { buffer, contentType } = parseDataUrlImage(dataUrl);
  return saveMenuItemImageFile(menuItemId, buffer, contentType);
}

export async function readMenuItemImageFile(
  menuItemId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const [buffer, metaText] = await Promise.all([
      fs.readFile(getImageBinaryPath(menuItemId)),
      fs.readFile(getImageMetaPath(menuItemId), "utf8"),
    ]);
    const meta = JSON.parse(metaText) as StoredImageMeta;
    return {
      buffer,
      contentType: meta.contentType || "image/jpeg",
    };
  } catch {
    return null;
  }
}

export async function deleteMenuItemImageFile(menuItemId: string): Promise<void> {
  await Promise.allSettled([
    fs.unlink(getImageBinaryPath(menuItemId)),
    fs.unlink(getImageMetaPath(menuItemId)),
  ]);
}
