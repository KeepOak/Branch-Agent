// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { QUICK_ASK_COMING, QUICK_ASK_EVENT, QuickAskHost } from "./QuickAskHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const AGENTS = { defaultId: "main", mainKey: "main", agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "ops", identity: { name: "Ops" } }] };
function setup(methods = ["agents.list", "sessions.create", "chat.send"]) {
  const request = vi.fn(async (method: string, params?: { key?: string }) => method === "agents.list" ? AGENTS : method === "sessions.create" ? { key: params?.key } : {});
  const open = vi.fn(async () => undefined), send = vi.fn(async () => undefined);
  const session = { request, open, send, onGatewayEvent: () => () => undefined, engine: { features: { methods, events: [] } } } as unknown as SaplingSession;
  let seen = false;
  // The contact appears in the list once sessions.create has made it.
  const list = { selectContact: vi.fn(async () => { const found = seen; seen = true; return found; }), refresh: vi.fn(async () => undefined) } as unknown as ConversationList;
  return { request, open, send, session, list, onOpen: vi.fn(), onNotice: vi.fn() };
}
async function render(t: ReturnType<typeof setup>) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<QuickAskHost session={t.session} ready list={t.list} onOpen={t.onOpen} onNotice={t.onNotice} />));
}
const box = () => document.querySelector<HTMLElement>("[data-testid=quick-ask]");
const press = async () => { await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); }); };
async function ask(text: string, to?: string) {
  const field = document.querySelector<HTMLInputElement>("[aria-label='Ask anything']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (to) await act(async () => [...document.querySelectorAll<HTMLButtonElement>("[role=radio]")].find(b => b.textContent === to)!.click());
  await act(async () => document.querySelector<HTMLButtonElement>("[data-testid=quick-ask-start]")!.click());
}

describe("Quick ask in R1 (Classic QuickAsk re-hosted)", () => {
  it("Ctrl Shift Space opens and closes the Classic box, drawn as item 48 clear glass", async () => {
    const t = setup();
    await render(t);
    expect(box()).toBeNull();
    await press();
    expect(box()).not.toBeNull();
    expect(box()!.className).toContain("g-clear");
    expect(box()!.querySelector(".qa-to-l")!.className).toContain("g-label");
    expect([...box()!.querySelectorAll("[role=radio]")].map(b => b.textContent)).toEqual(["Sapling", "Ops"]);
    await press();
    expect(box()).toBeNull();
  });

  it("branch:quick-ask opens it, and Start makes a conversation with the Trunk under To and sends the question there", async () => {
    const t = setup();
    await render(t);
    await act(async () => { window.dispatchEvent(new CustomEvent(QUICK_ASK_EVENT)); });
    expect(box()).not.toBeNull();
    await ask("  What changed today?  ", "Ops");
    expect(box()).toBeNull();
    expect(t.request).toHaveBeenCalledWith("sessions.create", { key: "agent:ops:main", agentId: "ops" });
    expect(t.onOpen).toHaveBeenCalledWith("agent:ops:main");
    expect(t.open).toHaveBeenCalledWith("agent:ops:main");
    expect(t.send).toHaveBeenCalledWith("What changed today?");
    expect(t.onNotice).not.toHaveBeenCalled();
  });

  it("Escape closes it without sending", async () => {
    const t = setup();
    await render(t);
    await press();
    await act(async () => { document.querySelector("[aria-label='Ask anything']")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(box()).toBeNull();
    expect(t.request).not.toHaveBeenCalledWith("sessions.create", expect.anything());
  });

  it("an engine without sessions.create shows the Coming line and calls nothing", async () => {
    const t = setup(["agents.list", "chat.send"]);
    await render(t);
    await press();
    await ask("Hello");
    expect(t.onNotice).toHaveBeenCalledWith(`Coming · ${QUICK_ASK_COMING}`);
    expect(t.request).not.toHaveBeenCalledWith("sessions.create", expect.anything());
    expect(t.send).not.toHaveBeenCalled();
  });
});
