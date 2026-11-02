// @vitest-environment jsdom
// Classic look with no usable model: the first Send press names the real reason. Once models.list has settled with
// nothing usable, a press says Connect a model to get answers with the Connect a model button, never Still loading
// models, even while a background refresh (window focus) is in flight. A press while the list really is loading says
// Still loading models, that line clears by itself when loading ends, and the next press names the real reason.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";
import type { OpenTarget } from "./nav";
import { resetNoKeyDefaultForTests } from "./no-key-default";
import { STILL_LOADING_MODELS } from "./sending";

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

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };
function deferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}

/** models answers each models.list call; named false means the engine names no model at all. */
async function mount(models: (params: { refresh?: boolean }) => Promise<unknown>, named = true) {
  const model = named ? "openai/gpt-6-astra" : "";
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" }, model: { primary: model } }] };
    if (method === "sessions.describe") return { session: named ? { model } : {} };
    if (method === "sessions.list") return { defaults: named ? { model, modelProvider: "openai" } : {}, sessions: [] };
    if (method === "models.list") return models((params ?? {}) as { refresh?: boolean });
    if (method === "models.authStatus") return { providers: [] };
    if (method === "sessions.usage") return { totals: {} };
    if (method === "wizard.next") return { done: false, step: { id: "download", type: "confirm", message: "Download Qwen (5.7 GB)?", initialValue: false } };
    return {};
  });
  const engine: WindowEngine = { sessionKey: "agent:main:empty", agentId: "main", request: request as unknown as WindowEngine["request"], onEvent: () => () => undefined, scopes: [] };
  resetNoKeyDefaultForTests(engine);
  const onSend = vi.fn();
  const onOpen = vi.fn<(target: OpenTarget) => void>();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Oak" working={false} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} onOpen={onOpen} />));
  return { request, host, onSend, onOpen };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function press(host: HTMLElement, text: string) {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  return box;
}

/** Every alert line under the composer, as text. */
function alerts(host: HTMLElement): string {
  return [...host.querySelectorAll('[role="alert"]')].map((n) => n.textContent ?? "").join(" | ");
}

/** The hold line for no model carries the Connect a model button, and the button opens Add an account. */
async function expectConnectHold(host: HTMLElement, onOpen: ReturnType<typeof vi.fn>) {
  const hold = host.querySelector('[data-testid="hold-connect-model"]');
  expect(hold?.getAttribute("role")).toBe("alert");
  expect(hold?.textContent).toContain(CONNECT_MODEL_ANSWERS);
  const button = [...(hold?.querySelectorAll("button") ?? [])].find((b) => b.textContent === CONNECT_MODEL_ACTION);
  expect(button).toBeTruthy();
  await act(async () => button?.click());
  expect(onOpen).toHaveBeenCalledWith("settings/accounts/add");
}

describe("classic composer, first press with no usable model", () => {
  it("names Connect a model with its button once models settle empty, even while a refresh is in flight", async () => {
    const hang = deferred();
    const { host, onSend, onOpen } = await mount(async (params) => (params.refresh ? hang.promise : { models: [] }));
    await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')).not.toBeNull());
    await settle();
    // The window gets focus (the click into it): a forced catalog refresh starts and has not answered yet.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    const box = await press(host, "Hello, can you help me plan my week?");
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("Hello, can you help me plan my week?");
    expect(alerts(host)).not.toContain("Still loading models");
    await expectConnectHold(host, onOpen);
  });

  it("names Connect a model when no model is named at all, even before models.list answers", async () => {
    const pending = deferred();
    const { host, onSend, onOpen } = await mount(async () => pending.promise, false);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')).not.toBeNull());
    await press(host, "Hello");
    expect(onSend).not.toHaveBeenCalled();
    expect(alerts(host)).not.toContain("Still loading models");
    await expectConnectHold(host, onOpen);
  });

  it("clears Still loading models by itself when loading ends, then the next press names the real reason", async () => {
    const first = deferred();
    let calls = 0;
    const { host, onSend, onOpen } = await mount(async () => (calls++ === 0 ? first.promise : { models: [] }));
    await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
    await settle();
    await press(host, "Hello");
    expect(onSend).not.toHaveBeenCalled();
    expect(alerts(host)).toContain(STILL_LOADING_MODELS.split(".")[0]);
    await act(async () => first.resolve({ models: [] }));
    await settle();
    await vi.waitFor(() => expect(alerts(host)).not.toContain("Still loading models"));
    expect(host.querySelector('[data-testid="hold-connect-model"]')).toBeNull();
    await press(host, "Hello");
    expect(onSend).not.toHaveBeenCalled();
    expect(alerts(host)).not.toContain("Still loading models");
    await expectConnectHold(host, onOpen);
  });
});
