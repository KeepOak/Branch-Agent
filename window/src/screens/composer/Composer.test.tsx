// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import type { Limits } from "../../shell/status-data";
import { Composer } from "./Composer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

const LIMITS: Limits = { updatedAt: 0, refreshing: false, rows: [
  { id: "a", name: "ChatGPT · Account 2", provider: "openai-codex", email: "work@example.com", account: "", pill: "Measured", line: "", windows: [{ name: "5-hour", left: 61, reset: "", low: false }, { name: "Week", left: 30, reset: "", low: false }] },
] };

async function mount(opts: { methods?: string[]; models?: boolean; working?: boolean; offline?: boolean; dictation?: boolean; replyTo?: { entryId: string; name: string; text: string }; onClearReply?: () => void; placeholder?: string } = {}) {
  let row: Record<string, unknown> = { model: "openai/test", permissionMode: "guarded", thinkingLevel: "medium" };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { ...row } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: opts.models === false ? [] : [{ id: "test", provider: "openai", name: "Test Model", available: true, thinkingLevels: [{ id: "low", label: "low" }, { id: "medium", label: "medium" }, { id: "high", label: "high" }] }] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "talk.catalog") return { transcription: { ready: Boolean(opts.dictation) }, realtime: { ready: false } };
    if (method === "sessions.patch") { row = { ...row, ...params }; return {}; }
    return {};
  });
  const engine: WindowEngine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"], ...(opts.methods ? { features: { methods: opts.methods, events: [] } } : {}) } as WindowEngine;
  const send = vi.fn(), opened = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={Boolean(opts.working)} offline={Boolean(opts.offline)} onSend={send} onStop={() => {}} onToast={() => {}} onOpen={opened} onOpenConversation={() => {}}
    limits={LIMITS} row={{ key: "agent:scout:main", title: "Main", isMain: true, totalTokens: 36000, contextTokens: 256000 } as never} topics={[{ key: "agent:scout:t1", title: "Invoices" }]} running={[]} replyTo={opts.replyTo} onClearReply={opts.onClearReply} placeholder={opts.placeholder} />));
  return { host, request, send, opened };
}
const type = async (host: HTMLElement, text: string) => act(async () => {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
});
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);

describe("R1-04 composer", () => {
  it("draws the pill and the row: +, field, mic, ring, voice; permission, to Main chat, model, reasoning", async () => {
    const { host } = await mount();
    expect(host.querySelector(".r1c-pill [aria-label^='Attach']")).not.toBeNull();
    expect(host.querySelector(".g-ring")?.getAttribute("aria-label")).toContain("Usage 70% (ChatGPT · Account 2, this week) · nothing running · context 36k / 256k (14%)");
    expect([...host.querySelectorAll(".r1c-row .r1c-quiet")].map((b) => b.textContent)).toEqual(["Ask first", "to Main chat", "Test Model", "Medium"]);
    expect(button("Talk live with voice")?.getAttribute("data-coming")).toBeTruthy();
  });

  it("morphs voice into send when there is text, and sends through onSend", async () => {
    const { host, send } = await mount();
    expect(host.querySelector(".r1c-send")).toBeNull();
    await type(host, "Find the invoice");
    // Improve is live on an engine whose methods aren't known yet (improve.test.tsx covers the call).
    expect(button("Improve my draft")?.getAttribute("aria-disabled")).toBeNull();
    await act(async () => button("Send")!.click());
    expect(send).toHaveBeenCalledWith("Find the invoice", {}, undefined);
  });

  it("shows the message being answered, sends it with the next message and then clears it", async () => {
    const clear = vi.fn();
    const { host, send } = await mount({ replyTo: { entryId: "m1", name: "Scout", text: "The invoice is due Friday" }, onClearReply: clear });
    expect(host.querySelector("[data-testid='reply-chip']")?.textContent).toContain("Replying to Scout: The invoice is due Friday");
    expect(host.querySelector("[data-testid='reply-chip']")?.classList.contains("r1c-chip")).toBe(true);
    await type(host, "Pay it today");
    await act(async () => button("Send")!.click());
    expect(send).toHaveBeenCalledWith("Pay it today", { replyToId: "m1" }, undefined);
    expect(clear).toHaveBeenCalled();
  });

  it("changes the permission with sessions.patch permissionMode, and keeps Plan first visible and disabled", async () => {
    const { request } = await mount();
    await act(async () => button("Ask first")!.click());
    const plan = [...document.querySelectorAll<HTMLButtonElement>("[data-testid='mode-option']")].find((b) => b.textContent?.includes("Plan first"));
    expect(plan?.disabled).toBe(true);
    const auto = [...document.querySelectorAll<HTMLButtonElement>("[data-testid='mode-option']")].find((b) => b.textContent?.startsWith("Auto"));
    await act(async () => auto!.click());
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:scout:main", permissionMode: "workspace" });
  });

  it("changes reasoning with sessions.patch thinkingLevel", async () => {
    const { request } = await mount();
    await act(async () => button("Medium")!.click());
    await act(async () => button("High")!.click());
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:scout:main", thinkingLevel: "high" });
  });

  it("sends to a topic from the Main chat with chat.send on its key", async () => {
    const { host, request, send } = await mount();
    await act(async () => button("to Main chat")!.click());
    await act(async () => button("Invoices")!.click());
    await type(host, "Hello topic");
    await act(async () => button("Send")!.click());
    expect(send).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "agent:scout:t1", message: "Hello topic" }));
  });

  it("opens the + menu in the preview's order, with its unwired items as Coming rows in place (#1049)", async () => {
    const { host } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".r1c-pill [aria-label^='Attach']")!.click());
    // preview POPS.plusmenu: Files, Photo, Screenshot, Folder ›; Teach a task, Make a picture, Write a doc, sheet or slides,
    // Set a goal, Skills & saved prompts; Add from, Call; Run as a background job, Branch from here, Temporary chat, Check with me.
    expect([...document.querySelectorAll(".r1c-tile")].map((t) => t.textContent)).toEqual(["Files", "Photo", "Screenshot", "Folder ›"]);
    const rows = [...document.querySelectorAll(".r1c-plus .r1c-mi-t")].map((t) => t.textContent);
    expect(rows).toEqual(["Teach a task", "Make a picture", "Write a doc, sheet or slides", "Set a goal", "Skills & saved prompts", "Add from", "Call",
      "Run as a background job", "Branch from here", "Temporary chat", "Check with me"]);
    const off = [...document.querySelectorAll(".r1c-plus [aria-disabled='true']")].map((b) => b.textContent);
    expect(off).toEqual(["Screenshot", "Teach a task", "Write a doc, sheet or slides", "Branch from here", "Temporary chatOff", "Check with meOff"]);
    expect(comingControls().filter((c) => c.where.startsWith("+ menu ›")).map((c) => [c.where, c.need[0], c.hidden])).toEqual([
      ["+ menu › Screenshot", "desktop.observe", false], ["+ menu › Teach a task", "desktop.observe", false], ["+ menu › Write a doc, sheet or slides", "agents.documents.create", false],
      ["+ menu › Branch from here", "sessions.fork", false], ["+ menu › Temporary chat", "sessions.patch", false], ["+ menu › Check with me", "sessions.patch", false],
    ]);
    await act(async () => button("Call")!.click());
    const call = [...document.querySelectorAll(".r1c-plus .r1c-mi-t")].map((t) => t.textContent);
    expect(call).toEqual(expect.arrayContaining(["Phone call…", "Join a meeting…"]));
    expect([...document.querySelectorAll(".r1c-plus [aria-disabled='true']")].map((b) => b.textContent)).toEqual(["Phone call…", "Join a meeting…"]);
  });

  it("opens the ring popover with This computer, Running, Context and Every account", async () => {
    const { host } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".g-ring")!.click());
    const text = document.querySelector(".r1c-ringpop")?.textContent ?? "";
    for (const part of ["This computer", "Running", "Context", "36k / 256k (14%)", "Every account", "Check every account now", "Accounts and usage…"]) expect(text).toContain(part);
  });

  it("with no model connected says so in the field and the row", async () => {
    const { host, opened } = await mount({ models: false });
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe("Connect a model to start");
    await act(async () => button("Connect a model")!.click());
    expect(opened).toHaveBeenCalledWith("settings/accounts/add");
  });

  it("says the room's words in a group chat, and the Trunk's name everywhere else", async () => {
    const room = await mount({ placeholder: "Message the group · @ to call a Trunk" });
    expect(room.host.querySelector("textarea")?.getAttribute("placeholder")).toBe("Message the group · @ to call a Trunk");
    await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    const plain = await mount();
    expect(plain.host.querySelector("textarea")?.getAttribute("placeholder")).toBe("Message Scout");
    await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    const noModel = await mount({ models: false, placeholder: "Message the group · @ to call a Trunk" });
    expect(noModel.host.querySelector("textarea")?.getAttribute("placeholder")).toBe("Connect a model to start");
  });

  it("disables send with its reason while offline", async () => {
    const { host } = await mount({ offline: true });
    await type(host, "Hi");
    expect(button("Send")?.disabled).toBe(true);
    expect(button("Send")?.title).toBe("Offline: Branch is reconnecting.");
  });

  it("folds Dictate into the + menu when the dock is 300 px or narrower", async () => {
    vi.stubGlobal("ResizeObserver", class { fire: () => void; constructor(fire: () => void) { this.fire = fire; } observe() { this.fire(); } disconnect() {} });
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("r1c") ? 280 : 0; });
    try {
      const { host } = await mount({ dictation: true });
      expect(button("Dictate into the box")).toBeUndefined();
      await act(async () => host.querySelector<HTMLButtonElement>(".r1c-pill [aria-label^='Attach']")!.click());
      expect([...document.querySelectorAll(".r1c-plus .r1c-mi-t")].map((t) => t.textContent)).toContain("Dictate into the box");
      // With nothing typed there is nothing to improve, so the + menu has no Improve row.
      expect([...document.querySelectorAll(".r1c-plus .r1c-mi-t")].map((t) => t.textContent)).not.toContain("Improve my draft");
    } finally { width.mockRestore(); }
  });

  it("keeps Dictate in the pill on a wide dock and masks the row only while it scrolls", async () => {
    const { host } = await mount({ dictation: true });
    expect(button("Dictate into the box")?.closest(".r1c-pill")).not.toBeNull();
    expect(host.querySelector(".r1c-row")?.hasAttribute("data-overflow")).toBe(false);
  });

  it("R1-10: against an engine with no methods, every control is declared and every Coming item names its call", async () => {
    const { host } = await mount({ methods: [] });
    await type(host, "Find the invoice");
    await act(async () => host.querySelector<HTMLButtonElement>(".r1c-pill [aria-label^='Attach']")!.click());
    const undeclared = undeclaredControls(document).filter((el) => el.closest(".r1c, .g-popover")).map((el) => el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);
    expect(undeclared).toEqual([]);
    const coming = comingControls();
    expect(coming.filter((c) => c.need.length === 0).map((c) => c.where)).toEqual([]);
    const needOf = (where: string) => coming.find((c) => c.where === where)?.need;
    expect(needOf("Improve my draft")).toEqual(["sessions.companion.ask"]);
    expect(needOf("Dictate into the box")).toEqual(["talk.catalog"]);
    expect(coming.filter((c) => c.where.startsWith("+ menu ›")).map((c) => [c.where, c.need[0]])).toEqual([
      ["+ menu › Screenshot", "desktop.observe"], ["+ menu › Teach a task", "desktop.observe"], ["+ menu › Write a doc, sheet or slides", "agents.documents.create"],
      ["+ menu › Branch from here", "sessions.fork"], ["+ menu › Temporary chat", "sessions.patch"], ["+ menu › Check with me", "sessions.patch"],
    ]);
  });

  it("registers nothing as Coming that it draws as live", async () => {
    await mount();
    expect(comingControls().every((c) => c.reason.length > 0)).toBe(true);
  });
});

// The owner's final glass model (Private docs/design/r1 README item 48) as it lands in the composer: the composer, its row and its
// menus sit on clear glass, and every piece of text is on a small frosted pill whose ink passes 4.5:1 composited over pure white
// and pure black (so it holds over any wallpaper, even where the blur doesn't render).
const css = readFileSync(resolve("src/screens/composer/composer.css"), "utf8");
const tokens = readFileSync(resolve("src/theme/tokens.css"), "utf8");

type Rgba = [number, number, number, number];
const parse = (value: string): Rgba => {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const fn = v.match(/^rgba?\(([^)]+)\)$/);
  if (!fn) throw new Error(`not a colour: ${v}`);
  const p = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const over = (c: Rgba, base: number[]) => [0, 1, 2].map((k) => c[k] * c[3] + base[k] * (1 - c[3]));
const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** The worst contrast of an ink on a pill, over white and over black, with or without the chosen-row lift. */
const worst = (ink: string, fill: string, lift: string) => {
  const f = parse(fill), on = parse(lift);
  return Math.min(...[[255, 255, 255], [0, 0, 0]].flatMap((base) => {
    const plain = over(f, base);
    return [ratio(parse(ink), plain), ratio(parse(ink), over(on, plain))];
  }));
};
const block = (source: string, selector: string) => {
  const at = source.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return source.slice(at, source.indexOf("}", at));
};
const cssValue = (body: string, name: string) => body.match(new RegExp(`${name}:\\s*([^;]+);`))![1];

const light = block(css, ":root {"), dark = block(css, ':root[data-theme="dark"] {');
const lightInk = cssValue(block(tokens, ":root {"), "--ink"), darkInk = cssValue(block(tokens, ':root[data-theme="dark"] {'), "--ink");

describe("composer glass model (item 48)", () => {
  for (const [scheme, body, ink] of [["light", light, lightInk], ["dark", dark, darkInk]] as const) {
    it(`keeps every pill ink at 4.5:1 or better in ${scheme}`, () => {
      const fill = cssValue(body, "--r1c-p-fill"), lift = cssValue(body, "--r1c-p-on");
      for (const name of ["--r1c-p-ink2", "--r1c-p-bad"]) expect(worst(cssValue(body, name), fill, lift), name).toBeGreaterThanOrEqual(4.5);
      expect(worst(ink, fill, lift), "--ink").toBeGreaterThanOrEqual(4.5);
    });
  }

  it("makes the + menu, the row menus and the ring popover clear glass", () => {
    const clear = block(css, ".g-popover:has(> .r1c-menu), .g-popover:has(> .r1c-plus) {");
    expect(clear).toContain("background: transparent");
    expect(clear).toContain("backdrop-filter: none");
  });

  it("puts the pill, the row's buttons and every menu row on a frosted pill with a 1 px outline", () => {
    const pill = block(css, ".r1c-pill, .r1c-note, .r1c-quiet");
    for (const piece of [".r1c-quiet", ".r1c-tile", ".r1c-mi", ".c-mi", ".r1c-line", ".mi"]) expect(pill).toContain(piece);
    expect(pill).toContain("background: var(--r1c-p-fill)");
    expect(pill).toContain("inset 0 0 0 1px var(--r1c-p-edge)");
  });

  it("gives solid surfaces under Reduce transparency", () => {
    expect(block(css, ':root[data-transparency="reduce"] {')).toContain("--r1c-p-fill: var(--raise)");
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{ :root:not\(\[data-transparency\]\) \{ --r1c-p-fill: var\(--raise\)/);
  });
});
