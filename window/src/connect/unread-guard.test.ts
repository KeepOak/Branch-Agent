import { describe, expect, it } from "vitest";
import { SessionUnreadPatchGuard } from "./unread-guard";

describe("opening a contact thread or topic", () => {
  it("acknowledges only the opened key, including a hand-marked unread episode", () => {
    const guard = new SessionUnreadPatchGuard();
    expect(guard.shouldPatch("agent:oak:main", true, 100)).toBe(true);
    expect(guard.shouldPatch("agent:oak:main", true, 100)).toBe(false);
    expect(guard.shouldPatch("agent:oak:main", false, 100)).toBe(false);
    expect(guard.shouldPatch("agent:oak:topic", true, 200)).toBe(true);
    expect(guard.shouldPatch("agent:oak:topic", true, 200)).toBe(false);
    expect(guard.shouldPatch("agent:oak:main", true, 100)).toBe(true);
  });

  it("does not clear a new hand-marked unread episode until opened again", () => {
    const guard = new SessionUnreadPatchGuard();
    expect(guard.shouldPatch("agent:oak:topic", false)).toBe(false);
    expect(guard.shouldPatch("agent:oak:topic", true, 50)).toBe(false);
    guard.beginActivation("");
    expect(guard.shouldPatch("agent:oak:topic", true, 50)).toBe(true);
  });
});
