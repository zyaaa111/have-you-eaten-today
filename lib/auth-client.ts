import { buildApiUrl } from "./api-base";
import { getLocalIdentity, saveLocalIdentity } from "./identity";
import type { AuthSession, ProfileMembership, User } from "./types";

const LOCAL_SESSION_USER_KEY = "hyet_session_user_v1";

async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getLocalSessionUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LOCAL_SESSION_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function saveLocalSessionUser(user: User | null): void {
  if (typeof window === "undefined") return;
  if (!user) {
    localStorage.removeItem(LOCAL_SESSION_USER_KEY);
    return;
  }
  localStorage.setItem(LOCAL_SESSION_USER_KEY, JSON.stringify(user));
}

export function clearLocalSessionUser(): void {
  saveLocalSessionUser(null);
}

export async function registerAccount(email: string, password: string): Promise<AuthSession> {
  const session = await authFetch<AuthSession>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  persistSessionSideEffects(session);
  return session;
}

export async function loginAccount(email: string, password: string): Promise<AuthSession> {
  const session = await authFetch<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  persistSessionSideEffects(session);
  return session;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authFetch<{ success: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await authFetch<{ success: boolean }>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function confirmPasswordReset(email: string, token: string, newPassword: string): Promise<void> {
  await authFetch<{ success: boolean }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ email, token, newPassword }),
  });
}

export async function bindLocalProfile(profileId: string, spaceId: string): Promise<AuthSession> {
  const session = await authFetch<AuthSession>("/auth/bind-local-profile", {
    method: "POST",
    body: JSON.stringify({ profileId, spaceId }),
  });
  persistSessionSideEffects(session);
  return session;
}

export async function fetchAuthSession(): Promise<AuthSession> {
  const session = await authFetch<AuthSession>("/auth/session");
  persistSessionSideEffects(session);
  return session;
}

export async function logoutSession(): Promise<void> {
  await authFetch<{ success: boolean }>("/auth/logout", {
    method: "POST",
  });
  clearLocalSessionUser();
}

function persistSessionSideEffects(session: AuthSession): void {
  saveLocalSessionUser(session.user);
  if (!session.user) return;

  const localIdentity = getLocalIdentity();
  const matchedMembership = localIdentity
    ? session.profiles.find((membership) => membership.profile.id === localIdentity.profile.id)
    : undefined;

  if (matchedMembership) {
    saveMembershipAsLocalIdentity(matchedMembership);
    return;
  }

  if (session.profiles.length === 1) {
    saveMembershipAsLocalIdentity(session.profiles[0]!);
  }
}

export function saveMembershipAsLocalIdentity(membership: ProfileMembership): void {
  saveLocalIdentity({
    profile: membership.profile,
    space: membership.space,
  });
}
