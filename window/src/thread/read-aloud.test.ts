import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { readAloud, speakable } from "./read-aloud";

describe("read aloud", () => {
  it("speaks the words, not the Markdown", () => {
    expect(speakable("## Plan\n- **Read** the [survey](https://x.example/a)\n```js\ncode()\n```\nDone.")).toBe("Plan Read the survey Done.");
  });

  it("asks the engine's voice first, then falls back to this computer's", async () => {
    const request = vi.fn().mockRejectedValue(new Error("no speech service"));
    const engine = { request, onEvent: () => () => undefined, sessionKey: "k", scopes: [] } as unknown as WindowEngine;
    const speak = vi.fn((u: { onend?: () => void }) => u.onend?.());
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", function (this: { text: string }, text: string) { this.text = text; });
    const done = vi.fn();
    await readAloud(engine, "k1", "Hello **there**", done);
    expect(request).toHaveBeenCalledWith("talk.speak", { text: "Hello there" });
    expect(speak).toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
