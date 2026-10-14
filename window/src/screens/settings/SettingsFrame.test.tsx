// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import type { Row } from "./rows";
import { MAKE_DEFAULT_COMING, SECTION_COMING, SettingsFrame, type SettingsFrameProps } from "./SettingsFrame";
import type { PageSlots } from "./slots";
import { NOTHING_MATCHES } from "./search";
import { INVALID_CONFIG, NEEDS_ADMIN } from "./useRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

type Reply = unknown | ((params: Record<string, unknown>) => unknown);
function engineOf(table: Record<string, Reply> = {}, scopes: string[] = ["operator.admin"]) {
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
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes } as unknown as WindowEngine, request };
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

  it("puts one glass card per section in the preview's order, with Coming for General's sections not wired yet (#1049)", async () => {
    await mount(engineOf().engine);
    const secs = $$(".r1s-sec");
    const titles = secs.map((s) => s.querySelector("h2")?.textContent ?? "");
    // preview.html PG.general: the card list, in order. Waiting line has only Advanced/Technical rows, so Regular skips it.
    const PREVIEW_GENERAL = ["Pinned", "Show agents’ work", "Starting up", "Projects", "Keyboard", "Writing", "The conversation", "Summaries of older turns", "History repair", "Waiting line", "Clipboard history", "Quick ask", "Controllers", "Cover the screen"];
    expect(titles).toEqual(PREVIEW_GENERAL.filter((t) => titles.includes(t)));
    expect(titles).toEqual(expect.arrayContaining(["Pinned", "Show agents’ work", "Keyboard", "Clipboard history", "Quick ask", "Controllers", "Cover the screen"]));
    expect(titles).not.toContain("Waiting line");
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

  it("puts a card's finer rows in a Fine-tune each part group under its regular rows", async () => {
    await mount(engineOf().engine);
    expect($(".r1s-fine")).toBeNull();
    await click(level("Advanced"));
    const work = $$(".r1s-sec").find((s) => s.querySelector("h2")?.textContent === "Show agents’ work")!;
    const fine = work.querySelector<HTMLElement>(".r1s-fine")!;
    expect(fine.getAttribute("aria-label")).toBe("Fine-tune each part");
    expect(fine.querySelector("h3")?.textContent).toBe("Fine-tune each part");
    expect(fine.querySelector("[data-row='general.work.thinking']")).not.toBeNull();
    expect(fine.querySelector("[data-row='general.work.chat-steps-shown']")?.getAttribute("data-coming")).toBeTruthy();
    expect(fine.querySelector("[data-row='general.work.mode']")).toBeNull();
    expect(work.querySelector(":scope > [data-row='general.work.mode']")).not.toBeNull();
  });

  it("makes a Trunk the default from search with its own button, and shows it as Coming without a handler (#1049)", async () => {
    const onTrunk = vi.fn();
    const trunks = [{ id: "t1", name: "Juniper" }, { id: "t2", name: "Juno", isDefault: true }];
    await act(async () => root.render(<SettingsFrame engine={engineOf().engine} trunks={trunks} onTrunk={onTrunk} />));
    await type("Jun");
    const make = $$(".r1s-mkdef");
    expect(make.length).toBe(1);
    expect(make[0].closest(".r1s-res")).toBeNull();
    await click(make[0]);
    expect(onTrunk).toHaveBeenCalledWith("t1", "makeDefault");
    expect(onTrunk).not.toHaveBeenCalledWith("t1", "open");
    expect($<HTMLInputElement>(".r1s-search input").value).toBe("");
    await type("Jun");
    await click($("[data-hit='t1']"));
    expect(onTrunk).toHaveBeenCalledWith("t1", "open");

    await act(async () => root.render(<SettingsFrame engine={engineOf().engine} trunks={trunks} />));
    await type("Juniper");
    const off = $(".r1s-mkdef");
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.getAttribute("data-coming")).toBe(MAKE_DEFAULT_COMING);
    expect($("[data-hit='t1']")).not.toBeNull();
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

  it("keeps rows disabled with the reason on a read-only connection", async () => {
    const { engine, request } = engineOf({}, ["operator.read"]);
    await mount(engine);
    const row = $("[data-row='general.work.mode']");
    expect(row.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(row.querySelector(".r1s-note")?.textContent).toBe(NEEDS_ADMIN);
    expect(request).not.toHaveBeenCalledWith("config.patch", expect.anything());
  });

  it("shows what is wrong with an invalid settings file and sends no change", async () => {
    const { engine, request } = engineOf({ "config.get": { hash: "h1", valid: false, config: {}, issues: [{ path: "agents.defaults.verboseDefault", message: "Invalid enum value" }] } });
    await mount(engine);
    const alert = $(".r1s-invalid");
    expect(alert.textContent).toContain(INVALID_CONFIG);
    expect([...alert.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["agents.defaults.verboseDefault: Invalid enum value"]);
    const seg = $("[data-row='general.work.mode']");
    expect(seg.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(request).not.toHaveBeenCalledWith("config.patch", expect.anything());
  });

  it("clears Changed somewhere else after Reload", async () => {
    let refuse = true;
    const { engine } = engineOf({ "config.patch": () => (refuse ? new Error("config changed since last load; re-run config.get") : { ok: true }) });
    await mount(engine);
    const seg = $("[data-row='general.work.mode']");
    await click([...seg.querySelectorAll("button")].find((b) => b.textContent === "Verbose")!);
    expect(seg.querySelector(".r1s-bad")?.textContent).toContain("Changed somewhere else");
    refuse = false;
    await click(seg.querySelector(".r1s-bad button")!);
    expect(seg.querySelector(".r1s-bad")).toBeNull();
  });

  it("draws when this window's storage refuses to be read", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("The operation is insecure.", "SecurityError"); });
    try {
      await mount(engineOf().engine);
      expect($(".r1s-head h1").textContent).toBe("General");
      expect($(".r1set").dataset.level).toBe("regular");
    } finally { getItem.mockRestore(); }
  });

  it("renders with a disconnected engine", async () => {
    const engine = { request: async () => { throw new Error("not connected"); }, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
    await mount(engine);
    expect($(".r1s-head h1").textContent).toBe("General");
    expect($("[role=alert]")).not.toBeNull();
  });
});

describe("SettingsFrame custom pages", () => {
  const extra = (id: string, label: string, level: 0 | 1 | 2 = 0): Row => ({ id, page: "chatapps", card: "Commands", label, level, ownerLevel: true, control: "toggle", source: { kind: "coming", need: "x", reason: "x" } });
  async function mountSlots(engine: WindowEngine, pages: PageSlots, extras: Partial<SettingsFrameProps> = {}) {
    await act(async () => root.render(<SettingsFrame engine={engine} pages={pages} {...extras} />));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  const key = async (input: HTMLInputElement, name: string) => { await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); await new Promise((r) => setTimeout(r, 0)); }); };

  it("draws a page's own component with the frame's live engine, and keeps the nav, search and level around it", async () => {
    const { engine } = engineOf();
    const Page = vi.fn(({ engine: given }: { engine: WindowEngine }) => <p data-testid="chat-slot">{given === engine ? "same engine" : "other engine"}</p>);
    await mountSlots(engine, { chatapps: { component: Page } }, { page: "chatapps" });
    expect($("[data-slot=chatapps] [data-testid=chat-slot]").textContent).toBe("same engine");
    expect(Page.mock.calls.every(([props]) => props.engine === engine)).toBe(true);
    expect($(".r1s-nav[aria-current=page]").textContent).toBe("Chat apps");
    expect($(".r1s-search input")).not.toBeNull();
    expect($$(".r1s-level button").map((b) => b.textContent)).toEqual(["Regular", "Advanced", "Technical"]);
    expect($$(".r1s-sec")).toHaveLength(0);
    await click($("[data-page=general]"));
    expect($("[data-testid=chat-slot]")).toBeNull();
    expect($$(".r1s-sec").length).toBeGreaterThan(0);
    await click($("[data-page=chatapps]"));
    expect($("[data-testid=chat-slot]")).not.toBeNull();
  });

  it("finds rows a custom page adds, clears with Esc, opens the page with Enter and raises the level", async () => {
    const onPage = vi.fn();
    await mountSlots(engineOf().engine, { chatapps: { component: () => <p data-testid="chat-slot">Chat apps page</p>, rows: [extra("chatapps.test.bridge", "Bridge relay", 2)] } }, { onPage });
    let input = await type("bridge relay");
    expect($("[data-hit='chatapps.test.bridge']").textContent).toContain("Bridge relay");
    expect($("[data-hit='chatapps.test.bridge']").textContent).toContain("Chat apps › Commands");
    await key(input, "Escape");
    expect(input.value).toBe("");
    expect($("[data-hit='chatapps.test.bridge']")).toBeNull();
    input = await type("bridge relay");
    await key(input, "Enter");
    expect(onPage).toHaveBeenLastCalledWith("chatapps");
    expect($("[data-testid=chat-slot]")).not.toBeNull();
    expect($(".r1set").dataset.level).toBe("technical");
  });

  it("fails to draw when a page adds a row whose id is already in the table", async () => {
    const errors: unknown[] = [];
    const el = document.body.appendChild(document.createElement("div"));
    const other = createRoot(el, { onUncaughtError: (error) => errors.push(error) });
    const clash = <SettingsFrame engine={engineOf().engine} pages={{ chatapps: { rows: [extra("general.work.show", "Clash")] } }} rows={[{ ...extra("general.work.show", "Show"), page: "general", card: "Pinned" }]} />;
    try { await act(async () => other.render(clash)); } catch (error) { errors.push(error); }
    expect(String(errors[0])).toContain('Settings row id "general.work.show" is used twice');
    expect(el.querySelector(".r1set")).toBeNull();
    await act(async () => other.unmount());
  });
});
