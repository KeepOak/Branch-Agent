import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { advance, safeSignInUrl, type WizardStep } from "./account-login";

describe("account sign-in", () => {
  it("acknowledges sign-in notes, shows the device code, polls gateway progress, and stops at a question", async () => {
    const replies = [
      { done: false, step: { id: "n1", type: "note", message: "Open the page", deviceCode: { code: "AB-12" } } },
      { done: false, step: { id: "p1", type: "progress", executor: "gateway" } },
      { done: false, step: { id: "s1", type: "select", options: [{ value: "a", label: "A" }] } },
    ];
    const request = vi.fn(async () => replies.shift());
    const shown: WizardStep[] = [];
    const notes: string[] = [];
    const result = await advance(request as WindowEngine["request"], "sid", undefined, (s) => shown.push(s), notes);
    expect(result.step?.id).toBe("s1");
    expect(shown.map((s) => s.id)).toEqual(["n1", "p1"]);
    expect(notes).toEqual(["Open the page"]);
    expect(request.mock.calls.map((c) => (c as unknown[])[1])).toEqual([{ sessionId: "sid" }, { sessionId: "sid", answer: { stepId: "n1" } }, { sessionId: "sid" }]);
  });

  it("opens only web links", () => {
    expect(safeSignInUrl("https://auth.example/x")).toBe("https://auth.example/x");
    expect(safeSignInUrl("javascript:alert(1)")).toBeNull();
    expect(safeSignInUrl(undefined)).toBeNull();
  });
});
