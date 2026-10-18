// @vitest-environment jsdom
// Settings › Appearance › Conversation text size (Private #1100): messages and the composer get their own size,
// separate from the interface scale, kept on this device.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AppearancePage, APPEARANCE_ROWS } from "./appearance";
import { applySavedLook, forgetLookStore } from "./appearance-store";
import { APPEARANCE_ROWS as R1_ROWS } from "../../../screens/settings/pages/appearance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THEMES = [{ id: "grove", name: "Grove", description: "Grove.", source: "builtin", modes: ["light", "dark"] }];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  forgetLookStore();
  document.head.querySelector("#branch-look")?.remove();
  document.documentElement.removeAttribute("data-scale");
  globalThis.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof matchMedia;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: { id: "grove", mode: "system", scope: "profile", overrides: {} }, theme: THEMES[0], themes: THEMES };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Birch" }] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "models.list") return { models: [] };
    return { status: "ok" };
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><AppearancePage page="appearance" title="Appearance" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await Promise.resolve(); });
}
const row = (title: string) => [...host.querySelectorAll<HTMLElement>(".ctl")].find((c) => c.querySelector("b")?.textContent === title)!;
const buttonIn = (title: string, text: string) => [...row(title).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const lookCss = () => document.getElementById("branch-look")?.textContent ?? "";
const saved = () => JSON.parse(localStorage.getItem("branch.look") ?? "{}") as { device?: Record<string, unknown> };

describe("Settings › Appearance › Conversation text size", () => {
  it("sizes the conversation on its own, kept on this device", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    expect(buttonIn("Conversation text size", "100%").getAttribute("aria-pressed")).toBe("true");
    await act(async () => buttonIn("Conversation text size", "150%").click());
    expect(lookCss()).toContain(":root:root{--chat-text:1.5}");
    expect(lookCss()).not.toContain("zoom");
    expect(document.documentElement.hasAttribute("data-scale")).toBe(false);
    expect(saved().device?.chatSize).toBe("150");
    expect(request.mock.calls.some(([m, p]) => m === "users.prefs.set" && JSON.stringify(p).includes("chatSize"))).toBe(false);
    await act(async () => buttonIn("Conversation text size", "100%").click());
    expect(lookCss()).not.toContain("--chat-text");
  });

  it("is separate from the interface scale", async () => {
    const { engine } = engineOf();
    await render(engine);
    await act(async () => buttonIn("Interface scale", "125%").click());
    expect(lookCss()).toContain(":root:root{zoom:1.25}");
    expect(lookCss()).not.toContain("--chat-text");
    await act(async () => buttonIn("Conversation text size", "90%").click());
    expect(lookCss()).toContain(":root:root{zoom:1.25}");
    expect(lookCss()).toContain(":root:root{--chat-text:0.9}");
    expect(saved().device).toEqual({ scale: "125", chatSize: "90" });
  });

  it("comes back after a reload", () => {
    localStorage.setItem("branch.look", JSON.stringify({ device: { chatSize: "175" } }));
    applySavedLook();
    expect(lookCss()).toContain(":root:root{--chat-text:1.75}");
  });

  it("messages and the composer read the size", () => {
    const thread = readFileSync("src/thread/thread.css", "utf8");
    const composer = readFileSync("src/screens/composer/composer.css", "utf8");
    expect(thread).toContain("font-size: calc(clamp(14px, .35cqi + 10px, 15.5px) * var(--chat-text, 1));");
    expect(thread).toContain("font-size: calc(14px * var(--chat-text, 1));");
    expect(thread).toContain("font: calc(13px * var(--chat-text, 1)) var(--mono);");
    expect(composer).toContain("font-size: calc(15px * var(--chat-text, 1));");
  });

  it("is in the settings search and on the R1 Appearance page, on its own key", () => {
    expect(APPEARANCE_ROWS.some((r) => r.title === "Conversation text size" && r.sec === "Reading")).toBe(true);
    const r1 = R1_ROWS.find((r) => r.id === "appearance.reading.chat-size");
    expect(r1?.label).toBe("Conversation text size");
    expect(r1?.source).toEqual({ kind: "look", key: "chatSize" });
  });
});
