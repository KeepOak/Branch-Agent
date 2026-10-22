// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS } from "./connect-model";
import { FREE_MODEL_READY } from "./no-key-default";
import { Composer } from "./Composer";

const hook = vi.hoisted(() => ({ retry: undefined as (() => Promise<void>) | undefined }));
vi.mock("./useConversation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useConversation")>();
  return { ...actual, useConversation: (...args: Parameters<typeof actual.useConversation>) => {
    const result = actual.useConversation(...args);
    hook.retry = result.retryNoKey;
    return result;
  } };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  hook.retry = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount() {
  let finish!: (result: { ok: false; error: string }) => void;
  const activation = new Promise<{ ok: false; error: string }>((resolve) => { finish = resolve; });
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "wizard.next") return { done: true, status: "error", error: CONNECT_MODEL_ANSWERS };
    if (method === "branch.setup.activate") return activation;
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] } as WindowEngine;
  const send = vi.fn(), opened = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" working={false} disabled={false} onSend={send} onStop={() => {}} engine={engine} onOpen={opened} />));
  await vi.waitFor(() => expect(host.querySelector("textarea")?.placeholder).toBe("Connect a model to start"));
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Keep this message");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { host, box, send, opened, finish, request, button: host.querySelector<HTMLButtonElement>('[aria-label="Send"]')! };
}



describe("classic composer when no model can answer", () => {
  it.each(["Send", "Enter"])("%s stays enabled, keeps the draft, and shows the one-button Connect a model notice", async (action) => {
    const { host, box, button, send, opened } = await mount();
    expect(button.disabled).toBe(false);
    expect(host.querySelector('[data-testid="connect-model"]')).toBeNull();
    await act(async () => {
      if (action === "Send") button.click();
      else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(box.value).toBe("Keep this message");
    expect(send).not.toHaveBeenCalled();
    const notice = host.querySelector('[data-testid="connect-model"]')!;
    expect(notice.textContent).toContain(CONNECT_MODEL_ANSWERS);
    expect(notice.querySelectorAll("button")).toHaveLength(1);
    const connect = notice.querySelector("button")!;
    expect(connect.textContent).toBe(CONNECT_MODEL_ACTION);
    await act(async () => connect.click());
    expect(opened).toHaveBeenCalledWith("settings/accounts/add");
  });

  it("Send and Enter still wait while a free model is being tried, then enable after failure", async () => {
    const { host, box, button, send, finish, request } = await mount();
    let retry!: Promise<void>;
    await act(async () => { retry = hook.retry!(); });
    expect(request).toHaveBeenCalledWith("branch.setup.activate", { kind: "no-key-default", agentId: "scout" });
    expect(button.disabled).toBe(true);
    expect(box.placeholder).toBe(FREE_MODEL_READY);
    await act(async () => {
      button.click();
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(box.value).toBe("Keep this message");
    expect(send).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="connect-model"]')).toBeNull();
    await act(async () => { finish({ ok: false, error: CONNECT_MODEL_ANSWERS }); await retry; });
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(host.querySelector('[data-testid="connect-model"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS);
    expect(box.value).toBe("Keep this message");
    expect(send).not.toHaveBeenCalled();
  });
});
