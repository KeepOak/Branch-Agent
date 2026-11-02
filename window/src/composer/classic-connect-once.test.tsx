// @vitest-environment jsdom
// Classic look, empty conversation, no usable model: the empty state and the composer together show one Connect a
// model notice, before any press and after a held Send or Enter, the same as the Glass look.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadContext } from "../thread/context";
import { EmptyState } from "../thread/EmptyState";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";
import { resetNoKeyDefaultForTests } from "./no-key-default";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount() {
  const model = "openai/gpt-6-astra";
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list")
      return {
        defaultId: "main",
        agents: [{ id: "main", name: "Oak", identity: { name: "Oak" }, model: { primary: model } }],
      };
    if (method === "sessions.describe") return { session: { model } };
    if (method === "sessions.list")
      return { defaults: { model, modelProvider: "openai" }, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "sessions.usage") return { totals: {} };
    if (method === "wizard.next")
      return {
        done: false,
        step: {
          id: "download",
          type: "confirm",
          message: "Download Qwen (5.7 GB)?",
          initialValue: false,
        },
      };
    return {};
  });
  const engine: WindowEngine = {
    sessionKey: "agent:main:empty",
    agentId: "main",
    request: request as unknown as WindowEngine["request"],
    onEvent: () => () => undefined,
    scopes: [],
  };
  resetNoKeyDefaultForTests(engine);
  const onSend = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <ThreadContext.Provider
        value={{
          engine,
          sessionKey: engine.sessionKey,
          name: "Oak",
          toast: () => undefined,
          running: false,
        }}
      >
        <EmptyState onStart={() => undefined} />
        <Composer
          name="Oak"
          working={false}
          disabled={false}
          onSend={onSend}
          onStop={vi.fn()}
          engine={engine}
          onOpen={vi.fn()}
        />
      </ThreadContext.Provider>,
    ),
  );
  await vi.waitFor(() =>
    expect(
      host.querySelector('[data-testid="empty-state"] [data-testid="connect-model"]'),
    ).not.toBeNull(),
  );
  await settle();
  return { host, onSend };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
const notices = (host: HTMLElement) => host.querySelectorAll('[data-testid="connect-model"]');
const said = (host: HTMLElement) =>
  (host.textContent ?? "").split(CONNECT_MODEL_ANSWERS).length - 1;

async function type(host: HTMLElement, text: string) {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return box;
}

/** After a held send: one notice, in the composer, with its button; the empty state's copy is gone. */
function expectOneHeldNotice(host: HTMLElement) {
  expect(notices(host)).toHaveLength(1);
  expect(
    host.querySelector('[data-testid="hold-connect-model"] [data-testid="connect-model"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('[data-testid="empty-state"] [data-testid="connect-model"]'),
  ).toBeNull();
  expect(notices(host)[0]!.querySelector("button.connect-model-btn")?.textContent).toBe(
    CONNECT_MODEL_ACTION,
  );
  expect(said(host)).toBe(1);
}

describe("Classic empty conversation with no model shows one Connect a model notice", () => {
  it("shows exactly one notice before any press, in the empty state", async () => {
    const { host } = await mount();
    await type(host, "Hello, can you help me plan my week?");
    await settle();
    expect(notices(host)).toHaveLength(1);
    expect(
      host.querySelector('[data-testid="empty-state"] [data-testid="connect-model"]'),
    ).not.toBeNull();
  });

  it("after a held Send, pressed twice, the reason shows once with its Connect a model button", async () => {
    const { host, onSend } = await mount();
    const box = await type(host, "Hello, can you help me plan my week?");
    const send = host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    await act(async () => send.click());
    await act(async () => send.click());
    await settle();
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("Hello, can you help me plan my week?");
    expectOneHeldNotice(host);
  });

  it("after a held Enter the reason shows once too", async () => {
    const { host, onSend } = await mount();
    const box = await type(host, "Hello");
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(onSend).not.toHaveBeenCalled();
    expectOneHeldNotice(host);
  });
});
