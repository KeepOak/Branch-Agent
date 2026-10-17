// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { CONNECT_MODEL_ANSWERS } from "../../composer/connect-model";
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

async function mount(activate: "fail" | "hang" = "fail") {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "branch.setup.activate") {
      if (activate === "hang") return new Promise(() => {});
      return { ok: false, error: "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster." };
    }
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] } as WindowEngine;
  const send = vi.fn();
  const opened = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={false} offline={false} onSend={send} onStop={() => {}} onToast={() => {}} onOpen={opened} onOpenConversation={() => {}}
    limits={{ updatedAt: 0, refreshing: false, rows: [] }} row={{ key: "agent:scout:main", title: "Main" } as never} topics={[]} running={[]} />));
  return { host, send, opened };
}

const type = async (host: HTMLElement, text: string) => act(async () => {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("send when no model can answer", () => {
  it("never swallows Enter: keeps the draft, sends nothing, and shows Connect a model to get answers", async () => {
    const { host, send } = await mount("fail");
    await vi.waitFor(() => expect(host.querySelector('[data-testid="connect-model"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS));
    await type(host, "Hello");
    const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
    const sendBtn = host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.getAttribute("aria-disabled")).toBe("true");
    expect(sendBtn.getAttribute("data-blocked")).toBe("true");
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(box.value).toBe("Hello");
    expect(send).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="connect-model"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS);
    expect(host.querySelector('[data-testid="connect-model"] button')?.textContent).toBe("Connect a model");
  });

  it("clicking the disabled Send control still shows the same explanation", async () => {
    const { host, send } = await mount("fail");
    await type(host, "Hello");
    const form = host.querySelector("form")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(send).not.toHaveBeenCalled();
    expect(host.textContent).toContain(CONNECT_MODEL_ANSWERS);
  });
});
