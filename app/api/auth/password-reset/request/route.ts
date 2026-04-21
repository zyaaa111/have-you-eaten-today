import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db-server";
import { buildPasswordResetEmail, isMailConfigured, sendMail } from "@/lib/server-mail";
import {
  PASSWORD_RESET_RATE_LIMIT,
  PASSWORD_RESET_TOKEN_TTL_MS,
  checkRateLimit,
  consumeRateLimit,
  getResetRateLimitKey,
  hashPasswordResetToken,
  normalizeEmail,
  rateLimitError,
  validateEmail,
} from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!validateEmail(email)) {
    return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
  }

  if (!isMailConfigured()) {
    return NextResponse.json({ error: "当前未配置 QQ SMTP，暂时无法发送找回密码邮件" }, { status: 503 });
  }

  const rateLimitKey = getResetRateLimitKey(request, email);
  if (checkRateLimit(rateLimitKey, PASSWORD_RESET_RATE_LIMIT).limited) {
    return rateLimitError(PASSWORD_RESET_RATE_LIMIT);
  }

  const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ? LIMIT 1").get(email) as
    | { id: string; password_hash: string | null }
    | undefined;
  if (!user) {
    consumeRateLimit(rateLimitKey, PASSWORD_RESET_RATE_LIMIT);
    return NextResponse.json({ success: true });
  }

  const rawToken = uuidv4().replace(/-/g, "") + uuidv4().replace(/-/g, "");
  const tokenHash = hashPasswordResetToken(rawToken);
  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);
    db.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at, used_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    ).run(uuidv4(), user.id, tokenHash, now + PASSWORD_RESET_TOKEN_TTL_MS, now);
  })();

  const baseUrl = new URL(request.url);
  const resetUrl = `${baseUrl.origin}/login?mode=reset&email=${encodeURIComponent(email)}&token=${encodeURIComponent(rawToken)}`;
  await sendMail(
    buildPasswordResetEmail({
      email,
      resetUrl,
      isFirstPasswordSet: !user.password_hash,
    })
  );

  consumeRateLimit(rateLimitKey, PASSWORD_RESET_RATE_LIMIT);
  return NextResponse.json({
    success: true,
    ...(process.env.NODE_ENV !== "production" ? { debugResetToken: rawToken } : {}),
  });
}
