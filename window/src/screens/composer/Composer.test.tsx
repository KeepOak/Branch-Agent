// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { comingControls } from "../../glass/coming-registry";
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

async function mount(opts: { models?: boolean; working?: boolean; offline?: boolean; dictation?: boolean } = {}) {
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
  const engine: WindowEngine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] };
  const send = vi.fn(), opened = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={Boolean(opts.working)} offline={Boolean(opts.offline)} onSend={send} onStop={() => {}} onToast={() => {}} onOpen={opened} onOpenConversation={() => {}}
    limits={LIMITS} row={{ key: "agent:scout:main", title: "Main", isMain: true, totalTokens: 36000, contextTokens: 256000 } as never} topics={[{ key: "agent:scout:t1", title: "Invoices" }]} running={[]} />));
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
    expect(button("Improve my draft")?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => button("Send")!.click());
    expect(send).toHaveBeenCalledWith("Find the invoice", {}, undefined);
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

  it("opens the + menu with tiles and rows, hiding unwired items but listing them as Coming", async () => {
    const { host } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".r1c-pill [aria-label^='Attach']")!.click());
    expect([...document.querySelectorAll(".r1c-tile")].map((t) => t.textContent)).toEqual(["Files", "Photo", "Folder ›"]);
    const rows = [...document.querySelectorAll(".r1c-plus .r1c-mi-t")].map((t) => t.textContent);
    expect(rows).toEqual(expect.arrayContaining(["Make a picture", "Set a goal", "Skills & saved prompts", "Add from", "Run as a background job"]));
    expect(rows).not.toContain("Teach a task");
    expect(document.querySelectorAll(".r1c-plus [aria-disabled='true']")).toHaveLength(0);
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
      expect(comingControls().some((c) => c.where === "+ menu › Improve my draft" && c.hidden)).toBe(true);
    } finally { width.mockRestore(); }
  });

  it("keeps Dictate in the pill on a wide dock and masks the row only while it scrolls", async () => {
    const { host } = await mount({ dictation: true });
    expect(button("Dictate into the box")?.closest(".r1c-pill")).not.toBeNull();
    expect(host.querySelector(".r1c-row")?.hasAttribute("data-overflow")).toBe(false);
  });

  it("registers nothing as Coming that it draws as live", async () => {
    await mount();
    expect(comingControls().every((c) => c.reason.length > 0)).toBe(true);
  });
});
