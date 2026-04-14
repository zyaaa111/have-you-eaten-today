import { describe, expect, it } from "vitest";
import { buildApiUrl, getApiBaseUrl } from "../api-base";

describe("api-base", () => {
  it("should default to same-origin /api when env is missing", () => {
    expect(getApiBaseUrl(undefined)).toBe("/api");
    expect(buildApiUrl("/spaces/join", undefined)).toBe("/api/spaces/join");
  });

  it("should trim trailing slashes from explicit API base", () => {
    expect(getApiBaseUrl("https://example.com/api/")).toBe("https://example.com/api");
    expect(buildApiUrl("sync/menu-items", "https://example.com/api/")).toBe(
      "https://example.com/api/sync/menu-items"
    );
  });
});
