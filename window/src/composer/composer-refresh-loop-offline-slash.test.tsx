// @vitest-environment jsdom
// Follow-up to #2091. (1) A catalog-changed event must not start a forced models.list refresh: the engine announces
// every forced refresh as chat.metadata.changed again, so that would loop. (2) Offline, Enter on a slash command is
// held like any other message: nothing is sent and the draft stays. Both composers: Classic and the glass pill.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer as GlassComposer } from "../screens/composer/Composer";
import { Composer as ClassicComposer } from "./Composer";
import type { WindowEngine } from "./engine";
import { resetNoKeyDefaultForTests } from "./no-key-default";

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

type Kind = "classic" | "glass";
type EngineEvent = { event: string; payload: unknown };
const READY_MODELS = [{ id: "gpt-6-astra", provider: "openai", name: "gpt-6-astra", available: true }];
/** Stops a looping stub so a failing run ends instead of spinning forever. */
const ECHO_CAP = 25;

function refreshCalls(request: { mock: { calls: unknown[][] } }): number {
  return request.mock.calls.filter(([method, params]) => method === "models.list" && (params as { refresh?: boolean } | undefined)?.refresh === true).length;
}

async function mountComposer(kind: Kind, opts: { offline?: boolean; echoForcedRefresh?: boolean }) {
  const listeners = new Set<(event: EngineEvent) => void>();
  const announce = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  let echoes = 0;
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" }, model: { primary: "openai/gpt-6-astra" } }] };
    if (method === "sessions.describe") return { session: { model: "openai/gpt-6-astra" } };
    if (method === "sessions.list") return { defaults: { model: "openai/gpt-6-astra", modelProvider: "openai" }, sessions: [] };
    if (method === "models.list") {
      // Like the engine: a forced refresh rebuilds the catalog and announces it as changed.
      if (opts.echoForcedRefresh && (params as { refresh?: boolean } | undefined)?.refresh === true && echoes < ECHO_CAP) {
        echoes += 1;
        setTimeout(() => announce({ event: "chat.metadata.changed", payload: { modelCatalogChanged: true } }), 0);
      }
      return { models: READY_MODELS };
    }
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
  const offline = Boolean(opts.offline);
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  if (kind === "classic") {
    await act(async () => root?.render(<ClassicComposer name="Oak" working={false} disabled={false} offline={offline} onSend={onSend} onStop={vi.fn()} engine={engine} />));
  } else {
    await act(async () => root?.render(<GlassComposer name="Oak" engine={engine} working={false} offline={offline} onSend={onSend} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
      limits={{ updatedAt: 0, refreshing: false, rows: [] }} row={{ key: "agent:main:empty", title: "Main" } as never} topics={[]} running={[]} />));
  }
  await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
  await vi.waitFor(() => expect(request.mock.calls.some(([method]) => method === "models.list")).toBe(true));
  await settle();
  return { request, announce, host, onSend };
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

describe.each<Kind>(["classic", "glass"])("%s composer", (kind) => {
  it("does not loop when every forced refresh announces the catalog changed again", async () => {
    const { request, announce } = await mountComposer(kind, { echoForcedRefresh: true });
    const before = refreshCalls(request);
    await act(async () => announce({ event: "chat.metadata.changed", payload: { modelCatalogChanged: true } }));
    for (let i = 0; i < 10; i += 1) await settle();
    // The event itself is not a reason to force the providers again; at most one forced read follows it.
    expect(refreshCalls(request) - before).toBeLessThanOrEqual(1);
  });

  it("holds a slash command while offline and keeps the draft", async () => {
    const { host, onSend, request } = await mountComposer(kind, { offline: true });
    const box = await typeText(host, "/status");
    await act(async () => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(onSend).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([method]) => method === "chat.send")).toBe(false);
    expect(box.value).toBe("/status");
  });
});
