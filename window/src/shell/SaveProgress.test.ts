import { describe, expect, it, vi } from "vitest";
import { almostOut, askToSave, SAVE_TEXT } from "./SaveProgress";
import type { Limits } from "./status-data";

const limits = (left: number): Limits => ({ updatedAt: 1, refreshing: false, rows: [{ id: "openai-codex", name: "ChatGPT plan", account: "Plus", pill: "Measured", line: "", windows: [{ name: "5-hour", left, reset: "resets at 6 pm", low: left < 15 }, { name: "Week", left: 64, reset: "", low: false }] }] });

describe("save progress at 95%", () => {
  it("offers only when a measured window is 95% used", () => {
    expect(almostOut(limits(12))).toBeNull();
    expect(almostOut(limits(5))).toMatchObject({ name: "ChatGPT plan", window: "5-hour", used: 95 });
    expect(almostOut(null)).toBeNull();
  });
  it("Show me uses the window with the least left, with its real figure", () => {
    expect(almostOut(limits(12), 100)).toMatchObject({ window: "5-hour", used: 88 });
  });
  it("steers each running conversation without pausing it", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    expect(await askToSave({ request } as never, ["a", "b"])).toBe(2);
    expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "a", message: SAVE_TEXT, queueMode: "steer" }));
  });
});
