import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import { hashPassword, hashPasswordResetToken, normalizeEmail, validateEmail, validatePasswordStrength } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  let body: { email?: string; token?: string; newPassword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!validateEmail(email) || !token) {
    return NextResponse.json({ error: "缺少邮箱或重置令牌" }, { status: 400 });
  }

  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const user = db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").get(email) as { id: string } | undefined;
  if (!user) {
    return NextResponse.json({ error: "重置链接无效或已过期" }, { status: 400 });
  }

  const now = Date.now();
  const tokenRow = db.prepare(
    `SELECT id, user_id, expires_at, used_at
     FROM password_reset_tokens
     WHERE token_hash = ? AND user_id = ?
     LIMIT 1`
  ).get(hashPasswordResetToken(token), user.id) as
    | { id: string; user_id: string; expires_at: number; used_at: number | null }
    | undefined;

  if (!tokenRow || tokenRow.used_at || tokenRow.expires_at < now) {
    return NextResponse.json({ error: "重置链接无效或已过期" }, { status: 400 });
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?").run(
      hashPassword(newPassword),
      now,
      user.id
    );
    db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").run(now, tokenRow.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  })();

  return NextResponse.json({ success: true });
}
