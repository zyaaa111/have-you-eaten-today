import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db-server";
import {
  LOGIN_RATE_LIMIT,
  checkRateLimit,
  clearRateLimit,
  consumeRateLimit,
  createSessionResponse,
  getLoginRateLimitKey,
  normalizeEmail,
  rateLimitError,
  validateEmail,
  verifyPassword,
} from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!validateEmail(email) || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const rateLimitKey = getLoginRateLimitKey(request, email);
  if (checkRateLimit(rateLimitKey, LOGIN_RATE_LIMIT).limited) {
    return rateLimitError(LOGIN_RATE_LIMIT);
  }

  const user = db.prepare(
    "SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1"
  ).get(email) as { id: string; email: string; password_hash: string | null } | undefined;

  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    consumeRateLimit(rateLimitKey, LOGIN_RATE_LIMIT);
    const hasLegacyAccount = !!user && !user.password_hash;
    return NextResponse.json(
      {
        error: hasLegacyAccount
          ? "这个账号还没有设置密码，请使用“忘记密码/设置密码”完成首次设密"
          : "邮箱或密码错误",
      },
      { status: 401 }
    );
  }

  clearRateLimit(rateLimitKey);
  return createSessionResponse(user.id);
}
