import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "./db-server";
import type { AuthSession, ProfileMembership, User } from "./types";
import { isMailConfigured } from "./server-mail";

export const AUTH_SESSION_COOKIE = "hyet_session";
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const PASSWORD_SCRYPT_COST = 16_384;
const PASSWORD_SPLIT = "$";

type RateLimitConfig = {
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
  message: string;
};

type RateLimitRow = {
  id: string;
  attempts: number;
  window_started_at: number;
  blocked_until: number | null;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return "密码至少需要 8 位";
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "密码至少包含字母和数字";
  }
  return null;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const derived = crypto
    .scryptSync(password, salt, PASSWORD_KEY_BYTES, { N: PASSWORD_SCRYPT_COST })
    .toString("hex");
  return ["scrypt", salt, derived].join(PASSWORD_SPLIT);
}

export function verifyPassword(password: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  const [algo, salt, derived] = hash.split(PASSWORD_SPLIT);
  if (algo !== "scrypt" || !salt || !derived) return false;

  const candidate = crypto
    .scryptSync(password, salt, PASSWORD_KEY_BYTES, { N: PASSWORD_SCRYPT_COST })
    .toString("hex");

  const derivedBuffer = Buffer.from(derived, "hex");
  const candidateBuffer = Buffer.from(candidate, "hex");
  if (derivedBuffer.length !== candidateBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedBuffer, candidateBuffer);
}

export function generateSessionToken(): string {
  return crypto.randomUUID();
}

export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashPasswordResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getSessionTokenFromRequest(request: NextRequest): string | null {
  const cookieStore = (request as NextRequest & { cookies?: { get: (name: string) => { value?: string } | undefined } }).cookies;
  if (cookieStore?.get) {
    return cookieStore.get(AUTH_SESSION_COOKIE)?.value ?? null;
  }

  const header = request.headers.get("cookie");
  if (!header) return null;
  const token = header
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${AUTH_SESSION_COOKIE}=`));
  return token ? token.slice(`${AUTH_SESSION_COOKIE}=`.length) : null;
}

export function getSessionUserByToken(token: string | null): User | null {
  if (!token) return null;
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  const row = db.prepare(
    `SELECT users.id, users.email, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ? AND sessions.expires_at >= ?
     LIMIT 1`
  ).get(token, now) as { id: string; email: string; created_at: number } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
  };
}

export function getSessionUser(request: NextRequest): User | null {
  return getSessionUserByToken(getSessionTokenFromRequest(request));
}

export function getAuthSessionPayload(userId: string): AuthSession {
  const user = db.prepare(
    "SELECT id, email, created_at, password_hash FROM users WHERE id = ?"
  ).get(userId) as
    | { id: string; email: string; created_at: number; password_hash: string | null }
    | undefined;

  if (!user) {
    return { user: null, profiles: [], passwordResetConfigured: isMailConfigured() };
  }

  const memberships = db.prepare(
    `SELECT
       profiles.id AS profile_id,
       profiles.space_id,
       profiles.user_id,
       profiles.nickname,
       profiles.joined_at,
       spaces.invite_code,
       spaces.name,
       spaces.created_at
     FROM profiles
     JOIN spaces ON spaces.id = profiles.space_id
     WHERE profiles.user_id = ?
     ORDER BY profiles.joined_at ASC`
  ).all(userId) as Array<{
    profile_id: string;
    space_id: string;
    user_id: string | null;
    nickname: string;
    joined_at: number;
    invite_code: string;
    name: string;
    created_at: number;
  }>;

  const profiles: ProfileMembership[] = memberships.map((row) => ({
    profile: {
      id: row.profile_id,
      spaceId: row.space_id,
      userId: row.user_id ?? undefined,
      nickname: row.nickname,
      joinedAt: row.joined_at,
      isAccountBound: true,
    },
    space: {
      id: row.space_id,
      inviteCode: row.invite_code,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.created_at,
    },
  }));

  return {
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.created_at,
      hasPassword: !!user.password_hash,
    },
    profiles,
    passwordResetConfigured: isMailConfigured(),
  };
}

export function doesUserOwnProfile(userId: string, profileId: string, spaceId?: string): boolean {
  const row = db.prepare(
    `SELECT id
     FROM profiles
     WHERE id = ?
       AND user_id = ?
       ${spaceId ? "AND space_id = ?" : ""}
     LIMIT 1`
  ).get(...(spaceId ? [profileId, userId, spaceId] : [profileId, userId])) as { id: string } | undefined;
  return !!row;
}

export function getMembershipForUserInSpace(userId: string, spaceId: string): ProfileMembership | null {
  const row = db.prepare(
    `SELECT
       profiles.id AS profile_id,
       profiles.space_id,
       profiles.user_id,
       profiles.nickname,
       profiles.joined_at,
       spaces.invite_code,
       spaces.name,
       spaces.created_at
     FROM profiles
     JOIN spaces ON spaces.id = profiles.space_id
     WHERE profiles.user_id = ? AND profiles.space_id = ?
     LIMIT 1`
  ).get(userId, spaceId) as
    | {
        profile_id: string;
        space_id: string;
        user_id: string | null;
        nickname: string;
        joined_at: number;
        invite_code: string;
        name: string;
        created_at: number;
      }
    | undefined;

  if (!row) return null;
  return {
    profile: {
      id: row.profile_id,
      spaceId: row.space_id,
      userId: row.user_id ?? undefined,
      nickname: row.nickname,
      joinedAt: row.joined_at,
      isAccountBound: true,
    },
    space: {
      id: row.space_id,
      inviteCode: row.invite_code,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.created_at,
    },
  };
}

export function createSession(userId: string): string {
  const sessionId = generateSessionToken();
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    sessionId,
    userId,
    now + AUTH_SESSION_TTL_MS,
    now
  );
  return sessionId;
}

export function buildSessionCookie(sessionId: string) {
  const now = Date.now();
  return {
    name: AUTH_SESSION_COOKIE,
    value: sessionId,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(now + AUTH_SESSION_TTL_MS),
    },
  };
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export function createSessionResponse(userId: string): NextResponse {
  const response = NextResponse.json(getAuthSessionPayload(userId));
  const sessionId = createSession(userId);
  const cookie = buildSessionCookie(sessionId);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export function getRequestFingerprint(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export function checkRateLimit(key: string, config: RateLimitConfig): { limited: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const row = db.prepare(
    "SELECT id, attempts, window_started_at, blocked_until FROM auth_rate_limits WHERE id = ?"
  ).get(key) as RateLimitRow | undefined;

  if (!row) {
    return { limited: false };
  }

  if (row.blocked_until && row.blocked_until > now) {
    return { limited: true, retryAfterMs: row.blocked_until - now };
  }

  if (now - row.window_started_at > config.windowMs) {
    db.prepare("DELETE FROM auth_rate_limits WHERE id = ?").run(key);
    return { limited: false };
  }

  if (row.attempts >= config.maxAttempts) {
    const blockedUntil = now + config.blockMs;
    db.prepare("UPDATE auth_rate_limits SET blocked_until = ? WHERE id = ?").run(blockedUntil, key);
    return { limited: true, retryAfterMs: config.blockMs };
  }

  return { limited: false };
}

export function consumeRateLimit(key: string, config: RateLimitConfig): void {
  const now = Date.now();
  const row = db.prepare(
    "SELECT id, attempts, window_started_at FROM auth_rate_limits WHERE id = ?"
  ).get(key) as { id: string; attempts: number; window_started_at: number } | undefined;

  if (!row || now - row.window_started_at > config.windowMs) {
    db.prepare(
      `INSERT INTO auth_rate_limits (id, attempts, window_started_at, blocked_until)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = NULL`
    ).run(key, 1, now);
    return;
  }

  db.prepare("UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE id = ?").run(key);
}

export function clearRateLimit(key: string): void {
  db.prepare("DELETE FROM auth_rate_limits WHERE id = ?").run(key);
}

export function rateLimitError(config: RateLimitConfig): NextResponse {
  return NextResponse.json({ error: config.message }, { status: 429 });
}

export function getLoginRateLimitKey(request: NextRequest, email: string): string {
  return `login:${normalizeEmail(email)}:${getRequestFingerprint(request)}`;
}

export function getResetRateLimitKey(request: NextRequest, email: string): string {
  return `password-reset:${normalizeEmail(email)}:${getRequestFingerprint(request)}`;
}

export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 8,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
  message: "登录尝试过于频繁，请稍后再试",
};

export const PASSWORD_RESET_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 30 * 60 * 1000,
  blockMs: 30 * 60 * 1000,
  message: "找回密码请求过于频繁，请稍后再试",
};

export type AuthorizedSpaceMember =
  | { user: User; membership: ProfileMembership; response?: never }
  | { response: NextResponse; user?: never; membership?: never };

export function requireSpaceMembership(request: NextRequest, spaceId: string | null | undefined): AuthorizedSpaceMember {
  if (!spaceId) {
    return { response: NextResponse.json({ error: "缺少 space_id" }, { status: 400 }) };
  }

  const user = getSessionUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: "请先登录" }, { status: 401 }) };
  }

  const membership = getMembershipForUserInSpace(user.id, spaceId);
  if (!membership) {
    return { response: NextResponse.json({ error: "当前账号不属于该共享空间" }, { status: 403 }) };
  }

  return { user, membership };
}
