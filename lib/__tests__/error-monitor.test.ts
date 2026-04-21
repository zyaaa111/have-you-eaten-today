import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetErrorMonitorForTests,
  initErrorMonitor,
  reportError,
} from "@/lib/error-monitor";

function getPostedPayload(fetchSpy: ReturnType<typeof vi.spyOn>) {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

describe("error monitor", () => {
  beforeEach(() => {
    __resetErrorMonitorForTests();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.pushState(
      {},
      "",
      "/login?mode=reset&email=alice@example.com&token=secret-token&redirect=/settings"
    );
  });

  afterEach(() => {
    __resetErrorMonitorForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts to the default endpoint and redacts sensitive URL and context values", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    initErrorMonitor();
    reportError({
      type: "error",
      message: "boom",
      context: {
        email: "alice@example.com",
        password: "hunter2",
        nested: {
          authorization: "Bearer secret",
          safe: "visible",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/client-errors");

    const payload = getPostedPayload(fetchSpy);
    expect(payload.reports[0].url).toBe("/login?mode=reset");
    expect(payload.reports[0].context.nested.safe).toBe("visible");

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("token");
  });

  it("does not register global listeners more than once", () => {
    const addListenerSpy = vi.spyOn(window, "addEventListener");

    initErrorMonitor();
    initErrorMonitor();

    expect(addListenerSpy.mock.calls.filter(([name]) => name === "error")).toHaveLength(1);
    expect(addListenerSpy.mock.calls.filter(([name]) => name === "unhandledrejection")).toHaveLength(1);
    expect(addListenerSpy.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(1);
  });
});
