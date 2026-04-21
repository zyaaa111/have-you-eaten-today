import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db-server";
import {
  createSessionResponse,
  hashPassword,
  normalizeEmail,
  validateEmail,
  validatePasswordStrength,
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

  if (!validateEmail(email)) {
    return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const existingUser = db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").get(email) as { id: string } | undefined;
  if (existingUser) {
    return NextResponse.json({ error: "该邮箱已经注册，请直接登录或使用忘记密码" }, { status: 409 });
  }

  const userId = uuidv4();
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, password_updated_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, email, hashPassword(password), now, now);

  return createSessionResponse(userId);
}
