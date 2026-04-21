import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/client-errors/route";
import { db as serverDb } from "@/lib/db-server";

function createRequest(ip: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/client-errors", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  serverDb.prepare("DELETE FROM auth_rate_limits WHERE id LIKE 'client-errors:test-%'").run();
});

describe("client error route", () => {
  it("accepts valid reports and logs only sanitized data", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(createRequest("test-valid", {
      reports: [
        {
          type: "error",
          message: "client failed",
          url: "http://localhost/login?mode=reset&email=alice@example.com&token=secret-token",
          userAgent: "vitest",
          timestamp: 123,
          context: {
            password: "hunter2",
            nested: {
              email: "bob@example.com",
              safe: "visible",
            },
          },
        },
      ],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, count: 1 });

    const logged = consoleSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain("/login?mode=reset");
    expect(logged).toContain("visible");
    expect(logged).not.toContain("alice@example.com");
    expect(logged).not.toContain("bob@example.com");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain("email");
    expect(logged).not.toContain("token");
  });

  it("rejects invalid JSON", async () => {
    const response = await POST(createRequest("test-invalid-json", "{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "无效的 JSON" });
  });

  it("rejects too many reports in one request", async () => {
    const reports = Array.from({ length: 11 }, (_, index) => ({
      type: "error",
      message: `error-${index}`,
    }));

    const response = await POST(createRequest("test-too-many", { reports }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "单次上报过多" });
  });
});
