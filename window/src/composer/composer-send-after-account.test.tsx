// @vitest-environment jsdom
// After a model account is added, the composer must re-read models.list (config.changed, focus) and Send
// must work without a reload. A blocked send always names the reason; it never drops Enter in silence, and that
// reason goes away once the catalog recovers or a send goes out. Both composers: Classic and the glass pill.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer as GlassComposer } from "../screens/composer/Composer";
import { CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer as ClassicComposer } from "./Composer";
import type { WindowEngine } from "./engine";
import { resetNoKeyDefaultForTests } from "./no-key-default";
import { BRANCH_RECONNECTING, sendHoldReason, STILL_LOADING_MODELS } from "./sending";

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

describe("sendHoldReason", () => {
  it("names a blocked send and stays quiet when send can go", () => {
    expect(sendHoldReason({ preparing: true })).toBe(STILL_LOADING_MODELS);
    expect(sendHoldReason({ loadingModels: true })).toBe(STILL_LOADING_MODELS);
    expect(sendHoldReason({ offline: true })).toBe(BRANCH_RECONNECTING);
    expect(sendHoldReason({ noModel: true })).toBe(CONNECT_MODEL_ANSWERS);
    expect(sendHoldReason({})).toBeNull();
  });
});

type Kind = "classic" | "glass";
type EngineEvent = { event: string; payload: unknown };
const READY_MODELS = [{ id: "gpt-6-astra", provider: "openai", name: "gpt-6-astra", available: true }];

/** The alert a held send leaves: Classic draws it as a bad note, the glass pill as the Connect a model notice. */
function holdAlert(kind: Kind, host: HTMLElement): Element | undefined {
  if (kind === "glass") return host.querySelector('[data-testid="connect-model"]') ?? undefined;
  return [...host.querySelectorAll('[role="alert"]')].find((n) => n.textContent?.includes(CONNECT_MODEL_ANSWERS));
}

function listCalls(request: { mock: { calls: unknown[][] } }): number {
  return request.mock.calls.filter(([method]) => method === "models.list").length;
}

function refreshCalls(request: { mock: { calls: unknown[][] } }): number {
  return request.mock.calls.filter(([method, params]) => method === "models.list" && (params as { refresh?: boolean } | undefined)?.refresh === true).length;
}

async function mountComposer(kind: Kind, opts?: { modelsList?: () => Promise<unknown> }) {
  const catalog: { models: unknown[] } = { models: [] };
  const listeners = new Set<(event: EngineEvent) => void>();
  const announce = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" }, model: { primary: "openai/gpt-6-astra" } }] };
    if (method === "sessions.describe") return { session: { model: "openai/gpt-6-astra" } };
    if (method === "sessions.list") return { defaults: { model: "openai/gpt-6-astra", modelProvider: "openai" }, sessions: [] };
    if (method === "models.list") return opts?.modelsList ? opts.modelsList() : { models: catalog.models };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "sessions.usage") return { totals: {} };
    if (method === "branch.setup.activate.start") return {};
    if (method === "wizard.next") {
      return { done: false, step: { id: "download", type: "confirm", message: "Download Qwen (5.7 GB)?", initialValue: false } };
    }
    if (method === "wizard.cancel") return {};
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
  if (kind === "classic") {
    await act(async () => root?.render(<ClassicComposer name="Oak" working={false} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} />));
  } else {
    await act(async () => root?.render(<GlassComposer name="Oak" engine={engine} working={false} offline={false} onSend={onSend} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
      limits={{ updatedAt: 0, refreshing: false, rows: [] }} row={{ key: "agent:main:empty", title: "Main" } as never} topics={[]} running={[]} />));
  }
  return { request, announce, host, onSend, catalog };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function typeText(host: HTMLElement, text: string) {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return box;
}

async function pressEnter(box: HTMLTextAreaElement) {
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

/** No model yet: Enter is held and the Connect a model alert names why. */
async function holdOnce(kind: Kind) {
  const mounted = await mountComposer(kind);
  await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="composer"]')).not.toBeNull());
  await vi.waitFor(() => expect(mounted.request.mock.calls.some(([method]) => method === "models.list")).toBe(true));
  await settle();
  const box = await typeText(mounted.host, "Hello after sign-in");
  await pressEnter(box);
  expect(box.value).toBe("Hello after sign-in");
  expect(mounted.onSend).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(holdAlert(kind, mounted.host)).toBeTruthy());
  return { ...mounted, box };
}

describe.each<Kind>(["classic", "glass"])("%s composer send after an account is added", (kind) => {
  it("names why Enter did not send, then sends once the catalog refreshes", async () => {
    const { request, announce, onSend, catalog, box } = await holdOnce(kind);
    expect(refreshCalls(request)).toBeGreaterThan(0);

    catalog.models = READY_MODELS;
    await act(async () => announce({ event: "config.changed", payload: { path: "auth" } }));
    await settle();
    await pressEnter(box);
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[0]).toBe("Hello after sign-in");
  });

  it("clears the stale Connect a model alert once the catalog recovers", async () => {
    const { announce, host, catalog } = await holdOnce(kind);
    catalog.models = READY_MODELS;
    await act(async () => announce({ event: "config.changed", payload: { path: "auth" } }));
    await settle();
    await vi.waitFor(() => expect(holdAlert(kind, host)).toBeUndefined());
  });

  it("clears the stale Connect a model alert once a send goes out", async () => {
    const { host, onSend } = await holdOnce(kind);
    // Still no model: a command is not held, so it goes out while the catalog has not recovered yet.
    const box = await typeText(host, "/status");
    await pressEnter(box);
    expect(onSend).toHaveBeenCalled();
    expect(onSend.mock.calls[0]?.[0]).toBe("/status");
    expect(holdAlert(kind, host)).toBeUndefined();
  });

  it("does not re-read models.list on usage-only metadata", async () => {
    const { request, announce, host } = await mountComposer(kind);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
    await vi.waitFor(() => expect(listCalls(request)).toBeGreaterThan(0));
    await settle();
    const afterLoad = listCalls(request);
    const refreshes = refreshCalls(request);
    await act(async () => announce({ event: "chat.metadata.changed", payload: { modelCatalogChanged: false } }));
    await settle();
    expect(listCalls(request)).toBe(afterLoad);
    expect(refreshCalls(request)).toBe(refreshes);
  });

  it("re-reads models.list when metadata says the catalog changed, or omits the flag", async () => {
    const { request, announce, host } = await mountComposer(kind);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
    await vi.waitFor(() => expect(listCalls(request)).toBeGreaterThan(0));
    await settle();
    const afterLoad = refreshCalls(request);
    await act(async () => announce({ event: "chat.metadata.changed", payload: { modelCatalogChanged: true } }));
    await settle();
    expect(refreshCalls(request)).toBeGreaterThan(afterLoad);
    const afterTrue = refreshCalls(request);
    await act(async () => announce({ event: "chat.metadata.changed", payload: {} }));
    await settle();
    expect(refreshCalls(request)).toBeGreaterThan(afterTrue);
  });

  it("re-reads models.list when the window gets focus", async () => {
    const { request, host } = await mountComposer(kind);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
    await settle();
    const before = refreshCalls(request);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(refreshCalls(request)).toBeGreaterThan(before);
  });

  it("keeps FreeModelSetup mounted on usage-only metadata and when a catalog refresh throws", async () => {
    let failRefresh = false;
    const { request, announce, host } = await mountComposer(kind, {
      modelsList: async () => {
        if (failRefresh) throw new Error("catalog refresh failed");
        return { models: [] };
      },
    });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="free-model-setup"]')).not.toBeNull());
    const refreshes = refreshCalls(request);
    await act(async () => announce({ event: "chat.metadata.changed", payload: { modelCatalogChanged: false } }));
    await settle();
    expect(refreshCalls(request)).toBe(refreshes);
    expect(host.querySelector('[data-testid="free-model-setup"]')).not.toBeNull();
    failRefresh = true;
    await act(async () => announce({ event: "config.changed", payload: { path: "auth" } }));
    await settle();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="free-model-setup"]')).not.toBeNull());
    expect(request.mock.calls.some(([method]) => method === "wizard.cancel")).toBe(false);
  });
});
