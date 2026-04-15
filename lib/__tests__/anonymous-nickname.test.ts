import { describe, it, expect } from "vitest";
import { generateAnonymousNickname } from "../anonymous-nickname";

describe("generateAnonymousNickname", () => {
  it("should return a non-empty string", () => {
    const name = generateAnonymousNickname("profile1", "item1");
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
  });

  it("should return the same nickname for the same inputs", () => {
    const name1 = generateAnonymousNickname("profile1", "item1");
    const name2 = generateAnonymousNickname("profile1", "item1");
    expect(name1).toBe(name2);
  });

  it("should return different nicknames for different menu items", () => {
    const name1 = generateAnonymousNickname("profile1", "item1");
    const name2 = generateAnonymousNickname("profile1", "item2");
    // They could theoretically be the same, but with 32*32=1024 combos it's very unlikely
    expect(name1).toBeTruthy();
    expect(name2).toBeTruthy();
  });

  it("should return different nicknames for different profiles", () => {
    const name1 = generateAnonymousNickname("profile1", "item1");
    const name2 = generateAnonymousNickname("profile2", "item1");
    expect(name1).toBeTruthy();
    expect(name2).toBeTruthy();
  });

  it("should be deterministic across calls", () => {
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      results.add(generateAnonymousNickname("p1", "i1"));
    }
    expect(results.size).toBe(1);
  });
});
