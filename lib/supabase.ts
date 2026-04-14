import type { Space, Profile } from "./types";
import { buildApiUrl } from "./api-base";

const LOCAL_PROFILE_KEY = "hyet_profile_v1";
const LOCAL_SPACE_KEY = "hyet_space_v1";

export interface LocalIdentity {
  profile: Profile;
  space: Space;
}

export function saveLocalIdentity(identity: LocalIdentity): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(identity.profile));
  localStorage.setItem(LOCAL_SPACE_KEY, JSON.stringify(identity.space));
}

export function clearLocalIdentity(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LOCAL_PROFILE_KEY);
  localStorage.removeItem(LOCAL_SPACE_KEY);
}

export function getLocalIdentity(): LocalIdentity | null {
  if (typeof window === "undefined") return null;
  const profileRaw = localStorage.getItem(LOCAL_PROFILE_KEY);
  const spaceRaw = localStorage.getItem(LOCAL_SPACE_KEY);
  if (!profileRaw || !spaceRaw) return null;
  try {
    return {
      profile: JSON.parse(profileRaw) as Profile,
      space: JSON.parse(spaceRaw) as Space,
    };
  } catch {
    return null;
  }
}

export async function ensureAnonymousUser(): Promise<{ userId: string; error?: Error }> {
  const local = getLocalIdentity();
  if (local) return { userId: local.profile.id };

  try {
    const res = await fetch(buildApiUrl("/auth/anonymous"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { userId: string };
    return { userId: data.userId };
  } catch (e) {
    // fallback local id
    const fallbackId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return { userId: fallbackId, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
