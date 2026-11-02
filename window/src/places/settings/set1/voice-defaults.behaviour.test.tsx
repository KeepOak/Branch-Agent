// @vitest-environment jsdom
// Atlas VOICE-0128 (built fresh): Settings › Voice shows what ships on and off, in the owner's words. Push to talk
// and dictation start on; the wake word and the spoken morning brief start off; live dictation stops after 1.5 s.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { VoicePage } from "./voice";
import { VOICE_DEFAULTS } from "./voice-defaults";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const engine = {
  request: vi.fn(async (method: string) => {
    if (method === "tts.status") return { enabled: false, auto: "off" };
    if (method === "voicewake.get") return { triggers: ["Hey Branch"] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    return {};
  }),
  onEvent: () => () => undefined, sessionKey: "s", scopes: [],
} as unknown as WindowEngine;
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

async function render(level: 0 | 1 | 2) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><VoicePage page="voice" title="Voice" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const switchOf = (title: string) => row(title).querySelector<HTMLElement>('[role="switch"], input[type="checkbox"]')!;
const isOn = (el: HTMLElement) => el.getAttribute("aria-checked") === "true" || (el as HTMLInputElement).checked === true;

describe("voice defaults (what ships on or off)", () => {
  it("keeps the owner's list in one place", () => {
    expect(VOICE_DEFAULTS).toEqual({ listening: "Push to talk", dictation: true, wakeWord: false, morningBrief: false, silenceSeconds: 1.5 });
  });

  it("shows push to talk and dictation on at Regular", async () => {
    await render(0);
    const selected = row("Listening").querySelector('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]');
    expect(selected?.textContent).toBe("Push to talk");
    expect(isOn(switchOf("Dictation in the message box"))).toBe(true);
  });

  it("shows the wake word and the spoken morning brief off, and 1.5 s of silence, at Advanced", async () => {
    await render(1);
    expect(isOn(switchOf("Wake word"))).toBe(false);
    expect(isOn(switchOf("Spoken morning brief"))).toBe(false);
    expect(row("Spoken morning brief").textContent).toContain("Off until you choose");
    expect(row("Stop listening after silence").querySelector("input")?.value).toBe("1.5");
  });

  it("reads replies aloud only when the engine says so (auto read-aloud ships off)", async () => {
    await render(1);
    const aloud = row("Answer aloud").querySelector('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]');
    expect(aloud?.textContent).toBe("Never");
  });
});
