import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { getSessionUser, hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const record = db.prepare("SELECT password_hash FROM users WHERE id = ? LIMIT 1").get(user.id) as
    | { password_hash: string | null }
    | undefined;
  if (!record) {
    return NextResponse.json({ error: "账号不存在" }, { status: 404 });
  }

  if (record.password_hash && !verifyPassword(currentPassword, record.password_hash)) {
    return NextResponse.json({ error: "当前密码不正确" }, { status: 401 });
  }

  const now = Date.now();
  db.prepare("UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?").run(
    hashPassword(newPassword),
    now,
    user.id
  );

  return NextResponse.json({ success: true });
}
