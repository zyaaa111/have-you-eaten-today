import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAnonymousUser } from "../supabase";

const ORIGINAL_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

describe("supabase helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (ORIGINAL_API_BASE === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_API_BASE;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should default anonymous auth requests to /api", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ userId: "user_default" }),
    } as Response);

    const result = await ensureAnonymousUser();

    expect(result.userId).toBe("user_default");
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("/api/auth/anonymous");
  });

  it("should respect an explicit external API base", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com/api/";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ userId: "user_external" }),
    } as Response);

    const result = await ensureAnonymousUser();

    expect(result.userId).toBe("user_external");
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "https://example.com/api/auth/anonymous"
    );
  });
});
