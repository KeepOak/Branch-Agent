// @vitest-environment jsdom
// After a model account is added, the composer must re-read models.list (config.changed, focus) and Send
// must work without a reload. A blocked send always names the reason; it never drops Enter in silence.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";
import { resetNoKeyDefaultForTests } from "./no-key-default";
import { BRANCH_RECONNECTING, sendHoldReason, STILL_LOADING_MODELS } from "./sending";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("sendHoldReason", () => {
  it("names a blocked send and stays quiet when send can go", () => {
    expect(sendHoldReason({ preparing: true })).toBe(STILL_LOADING_MODELS);
    expect(sendHoldReason({ loadingModels: true })).toBe(STILL_LOADING_MODELS);
    expect(sendHoldReason({ offline: true })).toBe(BRANCH_RECONNECTING);
    expect(sendHoldReason({ noKeyError: "Connect a model to start" })).toBe("Connect a model to start");
    expect(sendHoldReason({ waitingForFreeModel: true })).toBe("Getting a free model ready…");
    expect(sendHoldReason({ noModel: true })).toBe(CONNECT_MODEL_ANSWERS);
    expect(sendHoldReason({})).toBeNull();
  });
});

describe("composer send after an account is added", () => {
  it("names why Enter did not send, then sends once the catalog refreshes", async () => {
    let models: unknown[] = [];
    const listeners = new Set<(event: { event: string; payload: unknown }) => void>();
    const announce = (event: { event: string; payload: unknown }) => {
      for (const listener of listeners) listener(event);
    };
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" }, model: { primary: "openai/gpt-6-astra" } }] };
      if (method === "sessions.describe") return { session: { model: "openai/gpt-6-astra" } };
      if (method === "sessions.list") return { defaults: { model: "openai/gpt-6-astra", modelProvider: "openai" }, sessions: [] };
      if (method === "models.list") return { models };
      if (method === "models.authStatus") return { providers: [] };
      if (method === "sessions.usage") return { totals: {} };
      return {};
    });
    const engine: WindowEngine = {
      sessionKey: "agent:main:empty",
      agentId: "main",
      request: request as unknown as WindowEngine["request"],
      onEvent: (handler) => {
        listeners.add(handler);
        return () => { listeners.delete(handler); };
      },
      scopes: [],
    };
    resetNoKeyDefaultForTests(engine);
    const onSend = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Composer name="Oak" working={false} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} />));
    await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')).not.toBeNull());

    const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Hello after sign-in");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(box.value).toBe("Hello after sign-in");
    expect(onSend).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Connect a model|account/i);

    models = [{ id: "gpt-6-astra", provider: "openai", name: "gpt-6-astra", available: true }];
    await act(async () => announce({ event: "config.changed", payload: { path: "auth" } }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')).toBeNull());

    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onSend).toHaveBeenCalled();
    expect(onSend.mock.calls[0]?.[0]).toBe("Hello after sign-in");
  });
});
