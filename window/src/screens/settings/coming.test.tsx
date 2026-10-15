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
import type { Row } from "./rows";
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
      // every expected page must be in the nav: a missing one fails here instead of being skipped
      const nav = host.querySelector(`[data-page="${page.id}"]`);
      expect(nav, `nav entry for ${page.id}`).not.toBeNull();
      await click(nav!);
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
    expect(needs).toEqual(expect.arrayContaining(["config.patch", "chat.send"]));
    // Sections with no rows yet (General's Keyboard and the rest, #1049) name a real engine call, never a page/card label.
    const comingSections = () => comingControls().filter((entry) => entry.reason.endsWith("comes to this page in a later update."));
    // General draws every card the preview has, each with its own rows (#1049): no General card is a whole-card Coming mark.
    expect(comingControls().filter((entry) => entry.where.startsWith("General › "))).toEqual([]);
    await click(host.querySelector("[data-page='remote']")!);
    expect(comingSections().length).toBeGreaterThan(0);
    expect(comingSections().flatMap((entry) => entry.need).filter((need) => !/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/.test(need))).toEqual([]);
    // It opens every Settings page at Technical; each native page adds its rows, so it needs more than the 5 s default.
  }, 20_000);

  it("hides Coming rows and all-Coming sections at Regular, and shows them with their reason from Advanced", async () => {
    const { engine } = engineOf(CALLS);
    const rows: Row[] = [
      { id: "general.writing.works", page: "general", card: "Writing", label: "Works today", level: 0, control: "toggle", source: { kind: "device", key: "x.works" } },
      { id: "general.writing.later", page: "general", card: "Writing", label: "Waits", level: 0, control: "toggle", source: { kind: "coming", need: "x.later", reason: "Waits comes in a later update." } },
      { id: "general.keyboard.later", page: "general", card: "Keyboard", label: "Only waits", level: 0, control: "toggle", source: { kind: "coming", need: "x.later", reason: "Only waits comes in a later update." } },
    ];
    await act(async () => root.render(<SettingsFrame engine={engine} page="general" rows={rows} />));
    await settle();
    const cards = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].map((s) => s.getAttribute("aria-label"));
    // Regular: only what works. A card whose rows all wait, and a card with no rows yet, are left out; the level stays.
    expect(host.querySelector(".r1set")?.getAttribute("data-level")).toBe("regular");
    expect(cards()).toEqual(["Writing"]);
    expect(host.querySelector('[data-row="general.writing.works"]')).not.toBeNull();
    expect(host.querySelector('[data-row="general.writing.later"]')).toBeNull();
    expect(host.textContent).not.toContain("later update");
    // Advanced: the Coming rows and the sections with no rows yet show, each with its reason.
    await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Advanced")!);
    expect(cards()).toEqual(expect.arrayContaining(["Writing", "Keyboard", "Starting up"]));
    expect(host.querySelector('[data-row="general.writing.later"] .r1s-note')?.textContent).toBe("Waits comes in a later update.");
    expect(host.querySelector('[data-row="general.keyboard.later"]')).not.toBeNull();
    expect(host.textContent).toContain("Starting up comes to this page in a later update.");
  });

  it("keeps the rows live and saving once the engine offers config and prefs", async () => {
    const { engine, request } = engineOf(CALLS);
    await act(async () => root.render(<SettingsFrame engine={engine} />));
    await settle();
    const control = host.querySelector<HTMLElement>(".r1s-row:not([aria-disabled]) .r1s-ctl")!;
    expect(control.getAttribute("aria-disabled")).toBeNull();
    expect(control.dataset.need).toMatch(/config\.patch|users\.prefs\.set/);
    // One named live row, always: General › "Show the thinking" saves agents.defaults.reasoningDefault through config.patch.
    await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical")!);
    const row = host.querySelector<HTMLElement>('[data-row="general.work.thinking"]');
    expect(row, "General › Show the thinking").not.toBeNull();
    expect(row!.getAttribute("aria-disabled")).toBeNull();
    const toggle = row!.querySelector<HTMLElement>(".r1s-sw");
    expect(toggle, "its switch").not.toBeNull();
    const before = request.mock.calls.length;
    await click(toggle!);
    expect(request.mock.calls.slice(before).map(([method]) => method)).toContain("config.patch");
    expect(undeclared()).toEqual([]);
  });
});
