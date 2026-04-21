import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLikeId } from "@/lib/like-id";
import { db as serverDb } from "@/lib/db-server";
import {
  buildLegacyProfilePlaceholder,
  redactUnboundProfileReferences,
} from "@/lib/server-profile-redaction";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server profile redaction", () => {
  it("should redact unbound profile ids and deterministic like ids consistently", () => {
    vi.spyOn(serverDb, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM profiles") && sql.includes("AND id IN")) {
        return {
          all: vi.fn().mockReturnValue([{ id: "legacy-profile" }]),
        } as never;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const originalLikeId = buildLikeId("space-1", "menu-1", "legacy-profile");
    const redacted = redactUnboundProfileReferences("space-1", [
      {
        id: originalLikeId,
        menuItemId: "menu-1",
        profileId: "legacy-profile",
        spaceId: "space-1",
      },
      {
        tableName: "likes",
        recordId: originalLikeId,
        beforeSnapshot: {
          id: originalLikeId,
          menuItemId: "menu-1",
          profileId: "legacy-profile",
          spaceId: "space-1",
        },
      },
      {
        profileId: "bound-profile",
      },
    ]);

    const placeholder = buildLegacyProfilePlaceholder("space-1", "legacy-profile");

    expect(redacted[0]).toMatchObject({
      menuItemId: "menu-1",
      profileId: placeholder,
      spaceId: "space-1",
      id: buildLikeId("space-1", "menu-1", placeholder),
    });
    expect(redacted[1]).toMatchObject({
      tableName: "likes",
      recordId: buildLikeId("space-1", "menu-1", placeholder),
    });
    expect((redacted[1] as { beforeSnapshot: { profileId: string } }).beforeSnapshot.profileId).toBe(placeholder);
    expect((redacted[2] as { profileId: string }).profileId).toBe("bound-profile");
  });
});
