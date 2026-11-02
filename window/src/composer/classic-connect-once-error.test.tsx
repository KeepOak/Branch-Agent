// @vitest-environment jsdom
// Classic look, no usable model, and the free model setup failed: after a held Send the composer's Connect a model
// notice says it once. The failed setup line keeps its Try again, without saying Connect a model again.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadContext } from "../thread/context";
import { EmptyState } from "../thread/EmptyState";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";
import { FREE_MODEL_FAILED, resetNoKeyDefaultForTests } from "./no-key-default";

const forced = vi.hoisted(() => ({ error: null as string | null }));
vi.mock("./useConversation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useConversation")>();
  return {
    ...actual,
    useConversation: (...args: Parameters<typeof actual.useConversation>) => ({
      ...actual.useConversation(...args),
      noKeyError: forced.error,
    }),
  };
});

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
  forced.error = null;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount(error: string) {
  forced.error = error;
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

async function holdSend(host: HTMLElement) {
  await type(host, "Hello, can you help me plan my week?");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  await settle();
}

const line = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="no-model"]');
const tryAgain = (host: HTMLElement) =>
  [...(line(host)?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Try again");

describe("Classic held Send after a failed free model setup", () => {
  it("says Connect a model once, and the failed setup line keeps Try again", async () => {
    const { host, onSend } = await mount(FREE_MODEL_FAILED);
    await holdSend(host);
    expect(onSend).not.toHaveBeenCalled();
    expect(notices(host)).toHaveLength(1);
    expect(
      host.querySelector('[data-testid="hold-connect-model"] [data-testid="connect-model"]'),
    ).not.toBeNull();
    expect(said(host)).toBe(1);
    expect(line(host)).not.toBeNull();
    expect(line(host)?.textContent).not.toContain(CONNECT_MODEL_ACTION);
    expect(tryAgain(host)).toBeDefined();
  });

  it("keeps a different setup error in words next to its Try again", async () => {
    const reason = "Not enough disk space for the free model";
    const { host } = await mount(reason);
    await holdSend(host);
    expect(said(host)).toBe(1);
    expect(line(host)?.textContent).toContain(reason);
    expect(tryAgain(host)).toBeDefined();
  });
});
