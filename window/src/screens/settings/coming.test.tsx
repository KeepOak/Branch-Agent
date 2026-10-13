// @vitest-environment jsdom
// R1-10 for Settings: against an engine whose hello lists no methods, every control either names its engine call (and
// is Coming, so nothing saves) or says it is local, on every page; once the engine offers the calls the rows save again.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { NAV, TOP_PAGES } from "./nav";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const CALLS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "themes.list"];
function engineOf(methods: string[]) {
  // The reads answer (a test engine), but the hello lists only `methods`.
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: {} };
    return { ok: true, status: "ok" };
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine, request };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const undeclared = () => undeclaredControls(host).map((el) => el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);
const typeIn = async (text: string) => {
  const input = host.querySelector<HTMLInputElement>(".r1s-search input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("R1 Settings, the Coming contract", () => {
  it("declares every control on every page against an engine with no methods, and saves nothing", async () => {
    const { engine, request } = engineOf([]);
    await act(async () => root.render(<SettingsFrame engine={engine} trunks={[{ id: "ledger", name: "Ledger", isDefault: false }]} />));
    await settle();
    // Technical shows every row and page.
    await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical")!);
    for (const page of [...TOP_PAGES, ...NAV.flatMap((group) => group.pages)]) {
      if (page.id === "chatapps" || page.id === "features") continue; // drawn by their own screens (slots), with their own tests
      const nav = host.querySelector(`[data-page="${page.id}"]`);
      if (!nav) continue;
      await click(nav);
      expect(undeclared(), page.id).toEqual([]);
    }
    await click(host.querySelector("[data-page='general']")!);
    await click(host.querySelector(".r1s-learn")!);
    expect(undeclared()).toEqual([]);
    const ask = [...host.querySelectorAll<HTMLElement>(".r1s-help .r1s-btn")].find((b) => b.textContent === "Ask a Trunk")!;
    expect(ask.getAttribute("aria-disabled")).toBe("true");
    await typeIn("Ledger");
    expect(undeclared()).toEqual([]);
    expect(host.querySelector(".r1s-mkdef")?.getAttribute("aria-disabled")).toBe("true");

    await typeIn("");
    const writes = request.mock.calls.length;
    const control = [...host.querySelectorAll<HTMLElement>(".r1s-row:not([aria-disabled]) .r1s-ctl")].find((ctl) => ctl.querySelector("button"))!;
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.querySelectorAll("button").length).toBeGreaterThan(0);
    for (const button of control.querySelectorAll("button")) await click(button);
    // (The level above is local: it keeps the choice on this device when the engine can't.)
    expect(request.mock.calls.slice(writes).map(([method]) => method)).not.toContain("config.patch");
    expect(request.mock.calls.slice(writes).map(([method]) => method)).not.toContain("users.prefs.set");
    const needs = comingControls().flatMap((entry) => entry.need);
    expect(needs).toEqual(expect.arrayContaining(["config.patch", "sessions.send"]));
    // Sections with no rows yet name a real engine call, never a page/card label.
    const sections = comingControls().filter((entry) => entry.reason.endsWith("comes to this page in a later update."));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.flatMap((entry) => entry.need).filter((need) => !/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/.test(need))).toEqual([]);
    expect(comingControls().find((entry) => entry.where === "General › Keyboard")?.need).toEqual(["config.patch"]);
  });

  it("keeps the rows live and saving once the engine offers config and prefs", async () => {
    const { engine, request } = engineOf(CALLS);
    await act(async () => root.render(<SettingsFrame engine={engine} />));
    await settle();
    const control = host.querySelector<HTMLElement>(".r1s-row:not([aria-disabled]) .r1s-ctl")!;
    expect(control.getAttribute("aria-disabled")).toBeNull();
    expect(control.dataset.need).toMatch(/config\.patch|users\.prefs\.set/);
    const toggle = host.querySelector<HTMLElement>(".r1s-row:not([aria-disabled]) .r1s-sw:not(:disabled)");
    if (toggle) {
      await click(toggle);
      expect(request.mock.calls.map(([method]) => method)).toEqual(expect.arrayContaining([expect.stringMatching(/config\.patch|users\.prefs\.set/)]));
    }
    expect(undeclared()).toEqual([]);
  });
});
