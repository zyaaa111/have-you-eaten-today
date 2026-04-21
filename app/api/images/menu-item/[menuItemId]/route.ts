import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import {
  deleteMenuItemImageFile,
  readMenuItemImageFile,
  saveMenuItemImageFile,
} from "@/lib/image-storage";
import { requireSpaceMembership } from "@/lib/server-auth";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ menuItemId: string }>;
};

function getSharedSpaceIdForMenuItem(menuItemId: string): string | null {
  const row = db.prepare("SELECT space_id FROM menu_items WHERE id = ? LIMIT 1").get(menuItemId) as
    | { space_id: string | null }
    | undefined;
  return typeof row?.space_id === "string" && row.space_id ? row.space_id : null;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { menuItemId } = await params;
  const sharedSpaceId = getSharedSpaceIdForMenuItem(menuItemId);
  if (sharedSpaceId) {
    const auth = requireSpaceMembership(request, sharedSpaceId);
    if ("response" in auth) return auth.response;
  }
  const image = await readMenuItemImageFile(menuItemId);
  if (!image) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(image.buffer), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { menuItemId } = await params;
  const sharedSpaceId = getSharedSpaceIdForMenuItem(menuItemId);
  if (sharedSpaceId) {
    const auth = requireSpaceMembership(request, sharedSpaceId);
    if ("response" in auth) return auth.response;
  }
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少图片文件" }, { status: 400 });
  }
  const arrayBuffer = await file.arrayBuffer();
  const imageUrl = await saveMenuItemImageFile(menuItemId, arrayBuffer, file.type || "image/jpeg");
  return NextResponse.json({ success: true, imageUrl });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { menuItemId } = await params;
  const sharedSpaceId = getSharedSpaceIdForMenuItem(menuItemId);
  if (sharedSpaceId) {
    const auth = requireSpaceMembership(request, sharedSpaceId);
    if ("response" in auth) return auth.response;
  }
  await deleteMenuItemImageFile(menuItemId);
  return NextResponse.json({ success: true });
}
