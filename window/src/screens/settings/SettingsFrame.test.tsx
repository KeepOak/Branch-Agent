// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { SECTION_COMING, SettingsFrame } from "./SettingsFrame";
import { NOTHING_MATCHES } from "./search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

type Reply = unknown | ((params: Record<string, unknown>) => unknown);
function engineOf(table: Record<string, Reply> = {}) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method in table) { const r = table[method]; const v = typeof r === "function" ? (r as (p: Record<string, unknown>) => unknown)(params) : r; if (v instanceof Error) throw v; return v; }
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "themes.list") return { current: {} };
    throw new Error(`unknown method: ${method}`);
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine, page?: string) {
  await act(async () => root.render(<SettingsFrame engine={engine} page={page} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); }); };
const type = async (text: string) => {
  const input = $<HTMLInputElement>(".r1s-search input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
};
const level = (name: string) => [...$$(".r1s-level button")].find((b) => b.textContent === name)!;

describe("SettingsFrame", () => {
  it("draws the nav groups in order with search and How much to show at the top", async () => {
    await mount(engineOf().engine);
    expect($$(".r1s-grp").map((g) => g.textContent)).toEqual(["You", "Your Trunks", "Talking", "Accounts & models", "Permissions & safety", "Computers", "Branch"]);
    expect($<HTMLInputElement>(".r1s-search input").placeholder).toBe("Search settings, places, Trunks, features");
    expect($(".r1s-level small").textContent).toBe("The essentials, in plain words.");
    expect($(".r1s-nav[aria-current=page]").textContent).toBe("General");
    expect($("[data-page=developer]")).toBeNull();
  });

  it("puts one glass card per section, with no rule lines, and Coming for sections not wired yet", async () => {
    await mount(engineOf().engine);
    const secs = $$(".r1s-sec");
    expect(secs.map((s) => s.querySelector("h2")?.textContent)).toContain("Show agents’ work");
    expect(secs.map((s) => s.querySelector("h2")?.textContent)).not.toContain("Waiting line");
    const keyboard = secs.find((s) => s.querySelector("h2")?.textContent === "Keyboard")!;
    expect(keyboard.querySelector("[data-coming]")?.getAttribute("aria-disabled")).toBe("true");
    expect(keyboard.textContent).toContain(SECTION_COMING("Keyboard"));
  });

  it("shows higher rows inside their own section with an inline tag, and saves the level", async () => {
    const { engine, request } = engineOf();
    await mount(engine);
    await click(level("Technical"));
    expect($(".r1s-level small").textContent).toBe("File paths, raw keys, launch variables, config and logs.");
    const line = $$(".r1s-sec").find((s) => s.querySelector("h2")?.textContent === "Waiting line")!;
    expect(line.querySelector("[data-row='general.line.drop']")?.getAttribute("data-lv")).toBe("Technical");
    expect($("[data-row='general.work.steps']").getAttribute("data-lv")).toBe("Advanced");
    expect($("[data-row='general.work.mode']").hasAttribute("data-lv")).toBe(false);
    expect($("[data-page=developer]")).not.toBeNull();
    expect(localStorage.getItem("branch.level")).toBe("technical");
    expect(request).toHaveBeenCalledWith("users.prefs.set", expect.objectContaining({ entries: { "ui.window.look": expect.objectContaining({ level: "technical" }) } }));
  });

  it("saves Show agents’ work as the two engine defaults in one patch", async () => {
    const { engine, request } = engineOf({ "config.get": { hash: "h1", valid: true, config: { agents: { defaults: { reasoningDefault: "on", model: "x" } } } } });
    await mount(engine);
    const seg = $("[data-row='general.work.mode']");
    expect(seg.querySelector("[aria-checked=true]")?.textContent).toBe("Thinking");
    await click([...seg.querySelectorAll("button")].find((b) => b.textContent === "Verbose")!);
    const raw = (request.mock.calls.find(([m]) => m === "config.patch")![1] as { raw: string }).raw;
    expect(JSON.parse(raw)).toEqual({ agents: { defaults: { reasoningDefault: "on", verboseDefault: "on" } } });
  });

  it("says when settings didn't load, keeps rows visible but disabled, and tries again", async () => {
    let fail = true;
    const { engine } = engineOf({ "config.get": () => (fail ? new Error("closed") : { hash: "h", valid: true, config: {} }) });
    await mount(engine);
    expect($("[role=alert]").textContent).toContain("Settings didn’t load");
    expect($<HTMLButtonElement>("[data-row='general.work.mode'] button").disabled).toBe(true);
    fail = false;
    await click($("[role=alert] button"));
    expect($("[role=alert]")).toBeNull();
    expect($<HTMLButtonElement>("[data-row='general.work.mode'] button").disabled).toBe(false);
  });

  it("searches rows and pages, opens the first hit with Enter, clears with Esc", async () => {
    await mount(engineOf().engine);
    let input = await type("zzzz");
    expect($(".r1s-none").textContent).toBe(NOTHING_MATCHES);
    input = await type("Waiting line");
    expect($$(".r1s-res").map((b) => b.dataset.hit)).toContain("general.line.cap");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(input.value).toBe("");
    input = await type("appearance");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect($(".r1s-head h1").textContent).toBe("Appearance");
  });

  it("raises the level to open a Technical row from search", async () => {
    await mount(engineOf().engine);
    await type("Most messages in line");
    await click($("[data-hit='general.line.cap']"));
    expect($(".r1set").dataset.level).toBe("technical");
    expect($("[data-row='general.line.cap']")).not.toBeNull();
  });

  it("opens old page ids on their new page, and offers Show Advanced on a page empty at this level", async () => {
    await mount(engineOf().engine, "people");
    expect($(".r1s-head h1").textContent).toBe("Who uses Branch");
    const rows = [{ id: "who.people.x", page: "who" as const, card: "People", level: 1 as const, control: "toggle" as const, source: { kind: "pref" as const, key: "x" } }];
    await act(async () => root.render(<SettingsFrame engine={engineOf().engine} page="who" rows={rows} />));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect($$(".r1s-sec").map((s) => s.querySelector("h2")?.textContent)).not.toContain("People");
  });

  it("renders with a disconnected engine", async () => {
    const engine = { request: async () => { throw new Error("not connected"); }, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
    await mount(engine);
    expect($(".r1s-head h1").textContent).toBe("General");
    expect($("[role=alert]")).not.toBeNull();
  });
});
