// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { CONNECT_MODEL_ANSWERS } from "../../composer/connect-model";
import { ChatView } from "../chat/ChatView";
import { Composer } from "./Composer";

// The Glass empty chat with no model: the empty chat and the composer together show one Connect a model notice, before
// any press and after a held Enter or Send.
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

async function mount() {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "branch.setup.activate") return { ok: false, error: "Setup cancelled. Chat stays open; connect a model when you want." };
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] } as WindowEngine;
  const send = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<>
    <ChatView name="Scout" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey="agent:scout:main" />
    <Composer name="Scout" engine={engine} working={false} offline={false} onSend={send} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
      limits={{ updatedAt: 0, refreshing: false, rows: [] }} row={{ key: "agent:scout:main", title: "Main" } as never} topics={[]} running={[]} />
  </>));
  return { host, send };
}

const notices = (host: HTMLElement) => host.querySelectorAll('[data-testid="connect-model"]');

const type = async (host: HTMLElement, text: string) => act(async () => {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("Glass empty chat with no model shows one Connect a model notice", () => {
  it("shows exactly one before any press, in the empty chat", async () => {
    const { host } = await mount();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="empty-chat"] [data-testid="connect-model"]')).toBeTruthy());
    await type(host, "Hello, can you help me plan my week?");
    await settle();
    expect(notices(host)).toHaveLength(1);
  });

  it("after a held Enter the reason shows once, with its Connect a model button", async () => {
    const { host, send } = await mount();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="empty-chat"] [data-testid="connect-model"]')).toBeTruthy());
    await type(host, "Hello");
    const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(box.value).toBe("Hello");
    expect(notices(host)).toHaveLength(1);
    expect(notices(host)[0].textContent).toContain(CONNECT_MODEL_ANSWERS);
    expect(notices(host)[0].querySelector("button.connect-model-btn")?.textContent).toBe("Connect a model");
  });

  it("after a held Send, pressed twice, the reason still shows once", async () => {
    const { host, send } = await mount();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="empty-chat"] [data-testid="connect-model"]')).toBeTruthy());
    await type(host, "Hello");
    const sendBtn = host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    await act(async () => sendBtn.click());
    await act(async () => sendBtn.click());
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(notices(host)).toHaveLength(1);
    expect(notices(host)[0].querySelector("button.connect-model-btn")?.textContent).toBe("Connect a model");
  });
});
