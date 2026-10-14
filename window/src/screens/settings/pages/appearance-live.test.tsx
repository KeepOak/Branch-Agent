// @vitest-environment jsdom
// Settings › Appearance in R1 (#976): the page draws every working Classic control, so the R1 window can open it
// instead of the Classic page. Each control the page draws itself is live against an engine that offers its calls,
// says which call it makes, and sends that call.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "themes.list", "themes.get", "themes.set", "themes.import",
  "agents.list", "agents.update", "models.list"];
function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { defaults: { utilityModel: "anthropic/small" } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: { id: "grove" }, themes: [{ id: "grove", name: "Branch Slate", source: "builtin" }] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling", model: { primary: "" } }] };
    if (method === "models.list") return { models: [{ provider: "anthropic", id: "big", name: "Big model" }] };
    return { ok: true, status: "ok" };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const change = async (el: HTMLSelectElement | HTMLInputElement, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
};
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const calls = (request: ReturnType<typeof engineOf>["request"], method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);

async function mount(onPage = vi.fn()) {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="appearance" pages={R1_PAGES} onPage={onPage} />));
  await settle();
  await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical")!);
  return { ...env, onPage };
}

const SLOT_ROWS = ["appearance.theme.mode", "appearance.theme.pick", "appearance.theme.accent", "appearance.background.preview", "appearance.pet.pick", "appearance.pet.had",
  "appearance.characters.each-trunk", "appearance.list.threads", "appearance.list.small-model"];

describe("R1 Settings › Appearance draws every working Classic control", () => {
  it("draws each of Classic's richer controls itself, live, with every control declared", async () => {
    await mount();
    for (const id of SLOT_ROWS) {
      const r = row(id);
      expect(r, id).not.toBeNull();
      expect(r!.hasAttribute("data-slot"), id).toBe(true);
      expect(r!.getAttribute("aria-disabled"), id).toBeNull();
      expect(r!.querySelector("[data-coming]"), id).toBeNull();
    }
    expect(undeclaredControls(host).map((el) => el.getAttribute("aria-label") || el.textContent)).toEqual([]);
  });

  it("light or dark sets the window's choice and saves it with themes.set", async () => {
    const { request } = await mount();
    await click([...row("appearance.theme.mode")!.querySelectorAll("button")].find((b) => b.textContent === "Dark")!);
    expect(calls(request, "themes.set")).toContainEqual({ mode: "dark" });
  });

  it("opens the theme gallery and the theme editor", async () => {
    await mount();
    await click([...row("appearance.theme.pick")!.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Browse"))!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Themes");
    await act(async () => root.render(<></>));
    await mount();
    await click([...row("appearance.theme.pick")!.querySelectorAll("button")].find((b) => b.textContent === "Make your own")!);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("takes any accent colour, as Classic's colour well does", async () => {
    const { request } = await mount();
    await change(row("appearance.theme.accent")!.querySelector<HTMLInputElement>('input[type="color"]')!, "#123456");
    expect(JSON.stringify(calls(request, "users.prefs.set"))).toContain("#123456");
  });

  it("picking None turns the pet and its roam off", async () => {
    const { request } = await mount();
    await change(row("appearance.pet.pick")!.querySelector("select")!, "otter");
    await change(row("appearance.pet.pick")!.querySelector("select")!, "none");
    const last = request.mock.calls.filter(([m]) => m === "users.prefs.set").pop()?.[1] as { entries: Record<string, Record<string, unknown>> };
    expect(last.entries["ui.window.look"]).not.toHaveProperty("pet");
    expect(last.entries["ui.window.look"]).not.toHaveProperty("roam");
  });

  it("keeps the pets you've had when a pet is picked", async () => {
    const { request } = await mount();
    await change(row("appearance.pet.pick")!.querySelector("select")!, "otter");
    const sent = JSON.stringify(calls(request, "users.prefs.set"));
    expect(sent).toContain("otter");
    expect(sent).toContain("petsHad");
    expect(sent).toContain('"roam":true'); // picking a pet turns it on
    // No pet is the default now, so the one picked is the only pet had.
    expect(row("appearance.pet.had")!.querySelector(".r1s-val")!.textContent).toMatch(/^1 of \d+/);
  });

  it("changes a Trunk's model with agents.update", async () => {
    const { request } = await mount();
    await change(row("appearance.characters.each-trunk")!.querySelector<HTMLSelectElement>('select[aria-label="Sapling: model"]')!, "anthropic/big");
    expect(calls(request, "agents.update")).toContainEqual({ agentId: "main", model: "anthropic/big" });
  });

  it("offers Tabs and Freedom Mode for threads, and a saved removed layout reads as Tabs", async () => {
    localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "side", width: 88, per: {} }));
    await mount();
    const labels = [...row("appearance.list.threads")!.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Tabs", "Freedom Mode"]);
    await click([...row("appearance.list.threads")!.querySelectorAll("button")].find((b) => b.textContent === "Freedom Mode")!);
    expect(JSON.parse(localStorage.getItem("branch-topics-t5")!).layout).toBe("free");
  });

  it("shows the small model and opens Models to change it", async () => {
    const { onPage } = await mount();
    expect(row("appearance.list.small-model")!.textContent).toContain("anthropic/small");
    await click([...row("appearance.list.small-model")!.querySelectorAll("button")].find((b) => b.textContent === "Change")!);
    expect(onPage).toHaveBeenCalledWith("models");
  });

  it("without the page's controls the same rows are Coming, never live and silent", async () => {
    const { engine } = engineOf();
    await act(async () => root.render(<SettingsFrame engine={engine} page="appearance" />));
    await settle();
    await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical")!);
    expect(row("appearance.theme.pick")!.getAttribute("aria-disabled")).toBe("true");
    expect(undeclaredControls(host)).toEqual([]);
  });

  it("#1049: Light / Dark / Auto, and the accent as the theme's own, swatches and any colour (preview accent6)", async () => {
    const { request } = await mount();
    const mode = row("appearance.theme.mode")!;
    expect([...mode.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Light", "Dark", "Auto"]);
    const acc = row("appearance.theme.accent")!;
    expect(acc.querySelector("select")).toBeNull();
    const swatches = [...acc.querySelectorAll<HTMLButtonElement>(".r1s-acc[aria-label^='Accent #']")];
    expect(swatches.length).toBeGreaterThanOrEqual(6);
    expect(acc.querySelector('[aria-label="The theme’s own accent"]')?.getAttribute("aria-pressed")).toBe("true");
    await click(swatches[1]);
    expect(swatches[1].getAttribute("aria-pressed")).toBe("true");
    expect(request.mock.calls.length).toBeGreaterThan(0);
  });

  it("#1049: see-through and cover are sliders, Conversation width is a device row, and Auto is the mode's name everywhere", async () => {
    await mount();
    for (const [id, max] of [["appearance.background.see-through", "60"], ["appearance.background.cover", "90"]] as const) {
      const range = row(id)!.querySelector<HTMLInputElement>('input[type="range"]')!;
      expect(range, id).not.toBeNull();
      expect(range.max).toBe(max);
      expect(row(id)!.querySelector('input[type="number"]')).toBeNull();
    }
    const width = row("appearance.reading.width")!;
    expect([...width.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Comfortable", "Wide", "Full"]);
    await click([...width.querySelectorAll("button")].find((b) => b.textContent === "Wide")!);
    expect(document.documentElement.getAttribute("data-chat-width")).toBe("wide");
    const { APPEARANCE_ROWS } = await import("./appearance");
    expect(APPEARANCE_ROWS.find((r) => r.id === "appearance.theme.mode")!.options!.map((o) => o.label)).toEqual(["Light", "Dark", "Auto"]);
  });

  it("#1049: What's shown has the status symbols and the preview's log and privacy rows; Make it yours has the preview's eight rows", async () => {
    await mount();
    expect([...row("appearance.shown.symbols")!.querySelectorAll(".r1s-symbol b")].map((b) => b.textContent)).toEqual(["This computer", "Gateway", "Room left", "Running", "Usage", "Branch version"]);
    for (const id of ["activity-log", "who-ran", "counts", "stability"]) expect(row("appearance.shown." + id)!.querySelector('[role="switch"], input[type="checkbox"], button'), id).not.toBeNull();
    expect([...row("appearance.shown.messages")!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Off", "Direct messages", "All"]);
    for (const id of ["notes", "crash"]) expect(row("appearance.shown." + id)!.getAttribute("aria-disabled"), id).toBe("true");
    const yours = [...host.querySelectorAll('[data-row^="appearance.yours."]')].map((r) => r.getAttribute("aria-label") ?? r.querySelector("b")?.textContent);
    expect(yours).toEqual(["Your pet", "This theme and background", "Got a seed?", "Pictures around Branch", "Your picture", "Overview background", "Chat background", "Trunk, group and topic pictures", "A pet of your own"]);
    const button = (id: string, text: string) => [...row(id)!.querySelectorAll("button")].find((b) => b.textContent === text)!;
    expect(button("appearance.yours.pet", "Copy seed").getAttribute("aria-disabled")).toBe("true");
    // Each opens its own Settings page (the frame then moves there).
    const { PasteSeed, YourPicture, TrunkPictures } = await import("./appearance-yours");
    for (const [Ctl, page] of [[PasteSeed, "seedbank"], [YourPicture, "card"], [TrunkPictures, "trunks"]] as const) {
      const go = vi.fn();
      await act(async () => root.render(<Ctl engine={{} as never} row={{} as never} onPage={go} />));
      await click(host.querySelector("button")!);
      expect(go).toHaveBeenCalledWith(page);
    }
  });

  it("#1049: Your pet names the pet you have, and Pictures around Branch shows the preview's five pictures", async () => {
    await mount();
    const pet = row("appearance.yours.pet")!;
    expect(pet.querySelector("b")?.textContent).toMatch(/^Your pet( · .+)?$/);
    const pics = row("appearance.yours.pictures")!;
    expect([...pics.querySelectorAll("figcaption")].map((f) => f.textContent)).toEqual(["A cloud computer at work", "A phone call in progress", "Joining a meeting", "Learning an app", "A timeline replaying"]);
    expect([...pics.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["cloud", "call", "meeting", "learn", "timeline"].map((id) => `/assets/art17/feature/${id}.webp`));
    const { YourPet } = await import("./appearance-yours");
    const { lookStore } = await import("../../../places/settings/set1/appearance-store");
    const engine = engineOf().engine;
    await act(async () => { await lookStore(engine).set("pet", "px-owl"); });
    await act(async () => root.render(<YourPet engine={engine} row={{} as never} />));
    expect(host.querySelector(".r1s-yours-pet b")?.textContent).toBe("Your pet · Pixel owl");
  });
});
