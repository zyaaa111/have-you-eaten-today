import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getSpace } from "@/app/api/spaces/[id]/route";
import { GET as getImage, DELETE as deleteImage } from "@/app/api/images/menu-item/[menuItemId]/route";
import { db as serverDb } from "@/lib/db-server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth hardening routes", () => {
  it("GET /api/spaces/[id] should require login", async () => {
    const response = await getSpace(new Request("http://localhost/api/spaces/space-1") as never, {
      params: { id: "space-1" },
    });

    expect(response!.status).toBe(401);
    await expect(response!.json()).resolves.toMatchObject({
      error: "请先登录",
    });
  });

  it("shared image routes should reject unauthenticated access", async () => {
    vi.spyOn(serverDb, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("SELECT space_id FROM menu_items WHERE id = ? LIMIT 1")) {
        return {
          get: vi.fn().mockReturnValue({ space_id: "space-1" }),
        } as never;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const getResponse = await getImage(new Request("http://localhost/api/images/menu-item/menu-1") as never, {
      params: Promise.resolve({ menuItemId: "menu-1" }),
    });
    const deleteResponse = await deleteImage(new Request("http://localhost/api/images/menu-item/menu-1", {
      method: "DELETE",
    }) as never, {
      params: Promise.resolve({ menuItemId: "menu-1" }),
    });

    expect(getResponse!.status).toBe(401);
    await expect(getResponse!.json()).resolves.toMatchObject({ error: "请先登录" });
    expect(deleteResponse!.status).toBe(401);
    await expect(deleteResponse!.json()).resolves.toMatchObject({ error: "请先登录" });
  });
});
