// @vitest-environment jsdom
// #977: Improve my draft asks the side model (sessions.companion.ask) to rewrite the draft. With the method it calls it
// and replaces the draft (Undo puts it back); with no methods it is Coming, naming the call, and nothing is undeclared.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { Composer } from "./Composer";
import { improvedText, improvePrompt } from "./improve";

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

const ALL = ["chat.send", "sessions.patch", "sessions.describe", "models.list", "agents.list", "sessions.companion.ask"];
async function mount(methods: string[], answer: unknown = "Please find the March invoice.") {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test", permissionMode: "guarded" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true }] };
    if (method === "sessions.companion.ask") return { answer, ts: 1 };
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request, onEvent: () => () => {}, scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={false} offline={false} onSend={vi.fn()} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
    limits={null} row={{ key: "agent:scout:main", title: "Main", isMain: true } as never} topics={[]} running={[]} />));
  return { host, request };
}
const box = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
const type = (host: HTMLElement, text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box(host), text);
  box(host).dispatchEvent(new Event("input", { bubbles: true }));
});
const improveButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Improve my draft"]')!;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

it("rewrites the draft with sessions.companion.ask, and Undo puts the old draft back", async () => {
  const { host, request } = await mount(ALL);
  await type(host, "find the march invoce pls");
  expect(improveButton().getAttribute("aria-disabled")).toBeNull();
  expect(improveButton().dataset.need).toBe("sessions.companion.ask");
  await act(async () => improveButton().click()); await flush();
  expect(request).toHaveBeenCalledWith("sessions.companion.ask", { sessionKey: "agent:scout:main", question: improvePrompt("find the march invoce pls") });
  expect(box(host).value).toBe("Please find the March invoice.");
  const undo = [...host.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;
  expect(undo.closest(".r1c-note")?.textContent).toContain("Improved your draft");
  await act(async () => undo.click());
  expect(box(host).value).toBe("find the march invoce pls");
});

it("leaves the draft alone and says so when the model returns nothing", async () => {
  const { host } = await mount(ALL, "  ");
  await type(host, "draft");
  await act(async () => improveButton().click()); await flush();
  expect(box(host).value).toBe("draft");
  expect(host.textContent).toContain("Your model didn’t return a rewrite, so your draft is unchanged.");
});

it("offers Improve in the + menu on a narrow dock and calls the same method", async () => {
  vi.stubGlobal("ResizeObserver", class { fire: () => void; constructor(fire: () => void) { this.fire = fire; } observe() { this.fire(); } disconnect() {} });
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("r1c") ? 280 : 0; });
  try {
    const { host, request } = await mount(ALL);
    await type(host, "find the march invoce pls");
    expect(document.querySelector('.r1c-pill button[aria-label="Improve my draft"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".r1c-pill [aria-label^='Attach']")!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>(".r1c-plus .r1c-mi")].find((b) => b.textContent?.includes("Improve my draft"))!;
    await act(async () => item.click()); await flush();
    expect(request).toHaveBeenCalledWith("sessions.companion.ask", expect.objectContaining({ sessionKey: "agent:scout:main" }));
    expect(box(host).value).toBe("Please find the March invoice.");
  } finally { width.mockRestore(); }
});

it("keeps Improve Coming, naming sessions.companion.ask, on an engine with no methods", async () => {
  const { host, request } = await mount([]);
  await type(host, "find the march invoce pls");
  expect(improveButton().getAttribute("aria-disabled")).toBe("true");
  await act(async () => improveButton().click()); await flush();
  expect(request.mock.calls.some(([method]) => method === "sessions.companion.ask")).toBe(false);
  expect(box(host).value).toBe("find the march invoce pls");
  expect(comingControls().find((c) => c.where === "Improve my draft")?.missing).toEqual(["sessions.companion.ask"]);
  expect(undeclaredControls(host.querySelector(".r1c-pill")!)).toEqual([]);
});

it("reads the rewrite out of tags, fences and quotes", () => {
  expect(improvedText("<draft>\nHello there.\n</draft>")).toBe("Hello there.");
  expect(improvedText("```\nHello there.\n```")).toBe("Hello there.");
  expect(improvedText("“Hello there.”")).toBe("Hello there.");
  expect(improvedText(undefined)).toBe("");
});
