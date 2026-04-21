import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createSpace } from "@/app/api/spaces/route";
import { POST as joinSpace } from "@/app/api/spaces/join/route";
import { db as serverDb } from "@/lib/db-server";

function createJsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "hyet_session=test-session",
    },
    body: JSON.stringify(body),
  }) as Parameters<typeof createSpace>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

function mockSessionQuery(sql: string) {
  if (sql.includes("DELETE FROM sessions WHERE expires_at < ?")) {
    return {
      run: vi.fn(),
    } as never;
  }
  if (sql.includes("FROM sessions") && sql.includes("JOIN users")) {
    return {
      get: vi.fn().mockReturnValue({
        id: "user-account",
        email: "tester@example.com",
        created_at: 100,
      }),
    } as never;
  }
  return null;
}

describe("spaces routes", () => {
  it("POST /api/spaces should return 409 when the account already belongs to a space", async () => {
    const insertSpace = vi.fn();
    const insertProfile = vi.fn();

    vi.spyOn(serverDb, "prepare").mockImplementation((sql: string) => {
      const sessionQuery = mockSessionQuery(sql);
      if (sessionQuery) return sessionQuery;
      if (sql.includes("SELECT id, space_id FROM profiles WHERE user_id = ?")) {
        return { get: vi.fn().mockReturnValue({ id: "profile-1", space_id: "space-existing" }) } as never;
      }
      if (sql.includes("INSERT INTO spaces")) {
        return { run: insertSpace } as never;
      }
      if (sql.includes("INSERT INTO profiles")) {
        return { run: insertProfile } as never;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await createSpace(
      createJsonRequest("http://localhost/api/spaces", {
        name: "新空间",
        nickname: "测试用户",
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "当前身份已加入其他空间，请先退出当前空间",
    });
    expect(insertSpace).not.toHaveBeenCalled();
    expect(insertProfile).not.toHaveBeenCalled();
  });

  it("POST /api/spaces/join should return 409 when the account already belongs to another space", async () => {
    const insertProfile = vi.fn();

    vi.spyOn(serverDb, "prepare").mockImplementation((sql: string) => {
      const sessionQuery = mockSessionQuery(sql);
      if (sessionQuery) return sessionQuery;
      if (sql.includes("SELECT * FROM spaces WHERE invite_code = ?")) {
        return {
          get: vi.fn().mockReturnValue({
            id: "space-target",
            invite_code: "TARGET1",
            name: "目标空间",
            created_at: 100,
          }),
        } as never;
      }
      if (sql.includes("SELECT * FROM profiles WHERE user_id = ?")) {
        return {
          get: vi.fn().mockReturnValue({
            id: "profile-1",
            space_id: "space-other",
            nickname: "旧昵称",
            joined_at: 50,
          }),
        } as never;
      }
      if (sql.includes("INSERT INTO profiles")) {
        return { run: insertProfile } as never;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await joinSpace(
      createJsonRequest("http://localhost/api/spaces/join", {
        invite_code: "TARGET1",
        nickname: "新昵称",
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "当前身份已加入其他空间，请先退出当前空间",
    });
    expect(insertProfile).not.toHaveBeenCalled();
  });

  it("POST /api/spaces/join should be idempotent for an account already in the same space", async () => {
    const insertProfile = vi.fn();

    vi.spyOn(serverDb, "prepare").mockImplementation((sql: string) => {
      const sessionQuery = mockSessionQuery(sql);
      if (sessionQuery) return sessionQuery;
      if (sql.includes("SELECT * FROM spaces WHERE invite_code = ?")) {
        return {
          get: vi.fn().mockReturnValue({
            id: "space-target",
            invite_code: "TARGET1",
            name: "目标空间",
            created_at: 100,
          }),
        } as never;
      }
      if (sql.includes("SELECT * FROM profiles WHERE user_id = ?")) {
        return {
          get: vi.fn().mockReturnValue({
            id: "profile-1",
            space_id: "space-target",
            nickname: "旧昵称",
            joined_at: 50,
          }),
        } as never;
      }
      if (sql.includes("INSERT INTO profiles")) {
        return { run: insertProfile } as never;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await joinSpace(
      createJsonRequest("http://localhost/api/spaces/join", {
        invite_code: "TARGET1",
        nickname: "新昵称",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      space: {
        id: "space-target",
        inviteCode: "TARGET1",
        name: "目标空间",
        createdAt: 100,
      },
      profile: {
        id: "profile-1",
        spaceId: "space-target",
        nickname: "旧昵称",
      },
    });
    expect(insertProfile).not.toHaveBeenCalled();
  });
});
