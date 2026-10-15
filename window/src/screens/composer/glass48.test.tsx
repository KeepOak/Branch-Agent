// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import type { Limits } from "../../shell/status-data";
import { Composer } from "./Composer";
// A real window reaches the microphone and audio; jsdom does not, and the live entry needs both.
Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) }, configurable: true });
(globalThis as { AudioContext?: unknown }).AudioContext ??= class {};

/* README item 48 (owner, final): only the window's left sidebar is frosted. The composer's menus (the + menu and its submenus,
   the permission, tools, send-to, model and reasoning menus, and the ring popover) are clear glass, and every heading, line of
   text and control in them sits on a small frosted pill with a 1px outline. The pill is composer.css's own frosted-pill rule
   (or the shared .g-label / .g-frost), so this test reads that rule's selector and checks every piece of visible text against it. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllGlobals(); });

const css = readFileSync("src/screens/composer/composer.css", "utf8");
const PILL = [".g-label", ".g-frost", ...css.match(/\/\* One frosted pill[^*]*\*\/\s*([^{]+)\{/)![1].replace(/\s+/g, " ").trim().split(/,(?![^(]*\))/).map((s) => s.trim())].join(", ");
const LIMITS: Limits = { updatedAt: 0, refreshing: false, rows: [
  { id: "a", name: "ChatGPT · Account 2", provider: "openai-codex", email: "", account: "", pill: "Measured", line: "", windows: [{ name: "5-hour", left: 61, reset: "", low: false }] },
] };

async function mount() {
  let row: Record<string, unknown> = { model: "openai/test", permissionMode: "guarded", thinkingLevel: "medium" };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { ...row } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true, thinkingLevels: [{ id: "low", label: "low" }, { id: "medium", label: "medium" }, { id: "high", label: "high" }] }] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "talk.catalog") return { transcription: { ready: true }, realtime: { ready: true } };
    if (method === "config.get") return { config: { tools: { web: { search: { enabled: true } } }, mcp: { servers: { files: { command: "files" } } } } };
    if (method === "skills.status") return { skills: [{ name: "pdf", description: "Reads PDFs", eligible: true }] };
    if (method === "sessions.patch") { row = { ...row, ...params }; return {}; }
    return {};
  });
  const engine: WindowEngine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={false} offline={false} onSend={() => {}} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
    limits={LIMITS} row={{ key: "agent:scout:main", title: "Main", isMain: true, totalTokens: 36000, contextTokens: 256000 } as never} topics={[{ key: "agent:scout:t1", title: "Invoices" }]} running={[]} />));
  await settle();
  return host;
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await settle(); };
/** The open menu: the shared popover or the classic one. */
const menu = () => document.querySelector(".g-popover, .c-pop")!;
/** Text that sits straight on the clear menu instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    if (!el.closest(PILL)) bare.push("<" + el.tagName.toLowerCase() + " class=\"" + el.className + "\"> " + el.textContent!.trim().slice(0, 48));
  }
  return bare;
}
/** The menu surface is clear: the shared clear class, or a composer.css rule that matches it and drops the fill and the blur. */
function isClear(pop: Element) {
  if (pop.classList.contains("g-clear")) return true;
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return rules.some(([, selector, body]) => body.includes("background: transparent") && body.includes("backdrop-filter: none")
    && selector.split(/,(?![^(]*\))/).map((s) => s.trim()).some((s) => !s.startsWith(":root") && !s.startsWith("@") && pop.matches(s)));
}

describe("composer menus follow the item 48 glass model", () => {
  it("draws the + menu and each of its submenus clear, with every tile, row and title on a pill", async () => {
    const host = await mount();
    const plus = host.querySelector(".r1c-pill [aria-label^='Attach']")!;
    await click(plus);
    expect(isClear(menu())).toBe(true);
    expect(bareText(menu())).toEqual([]);
    for (const sub of ["Folder ›", "Add from", "Call"]) {
      await click(button(sub));
      expect(bareText(menu()), sub).toEqual([]);
      await click(menu().querySelector(".r1c-back"));
    }
  });

  it("draws the permission, send-to, model and reasoning menus clear with every line on a pill", async () => {
    await mount();
    for (const opener of ["Ask first", "to Main chat", "Test Model", "Medium"]) {
      await click(button(opener));
      expect(isClear(menu()), opener).toBe(true);
      expect(bareText(menu()), opener).toEqual([]);
      await click(button(opener));
    }
  });

  it("draws the tools menu opened from the permission menu clear, with its header, search, sections and rows on pills", async () => {
    await mount();
    await click(button("Ask first"));
    await click(button("Tools for this conversation…"));
    const tools = document.querySelector(".c-plug")!;
    expect(tools).not.toBeNull();
    expect(isClear(tools)).toBe(true);
    expect(tools.querySelectorAll("[data-testid=tool-row]").length).toBeGreaterThan(0);
    expect(bareText(tools)).toEqual([]);
    await click(tools.querySelector(".c-libadd"));
    expect(tools.querySelector(".c-lib")).not.toBeNull();
    expect(bareText(tools)).toEqual([]);
  });

  it("draws the ring popover clear with every section, line and account row on a pill", async () => {
    const host = await mount();
    await click(host.querySelector(".g-ring"));
    expect(isClear(menu())).toBe(true);
    expect(bareText(menu())).toEqual([]);
  });

  it("uses no frosted fill from the earlier glass (--gc, --gf, --gk) anywhere in the composer's styles", () => {
    expect(css).not.toMatch(/var\(--g[cfk]-/);
  });
});
