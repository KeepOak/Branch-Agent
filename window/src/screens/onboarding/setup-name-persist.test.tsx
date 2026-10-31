// @vitest-environment jsdom
// #1812: the Welcome name has to outlive a restart when there is no profile, and a failed
// profile save must not trap the person on Welcome.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { ChatView, type ChatViewProps } from "../chat/ChatView";
import { DEFAULT_TRUNK_WHY, EXAMPLES_GREETING_KEY } from "../chat/examples-greeting";
import { Onboarding } from "./Onboarding";
import { saveDisplayName } from "./finish";
import { recalledSessionName, rememberSessionName } from "./session-name";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PLAIN_NAME_ERROR = "Couldn’t save your name. Try again in a moment.";
const TECHNICAL = "INVALID_REQUEST: users.setDisplayName refused";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  rememberSessionName("");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

function engineWith(name: string | null) {
  const request = vi.fn(async (method: string) => (method === "users.self" && name !== null ? { profile: { displayName: name } } : {}));
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], features: { methods: ["users.self", "chat.send"], events: [] } } as unknown as WindowEngine;
  return { engine, request };
}

async function showChat(props: Partial<ChatViewProps>, engine?: WindowEngine) {
  const view = <ChatView name="Sapling" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey="agent:main:main" examplesWhy={DEFAULT_TRUNK_WHY} {...props} />;
  await act(async () => root?.render(engine ? <CapabilityProvider engine={engine}>{view}</CapabilityProvider> : view));
  await flush();
}
const greeting = () => host.querySelector<HTMLElement>(`[data-block-key="${EXAMPLES_GREETING_KEY}"]`);

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const cur = out[key];
    out[key] = value && typeof value === "object" && !Array.isArray(value) && cur && typeof cur === "object" && !Array.isArray(cur)
      ? merge(cur as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return out;
}

/** A fresh profile whose name write fails with a technical error. Access can still be saved. */
function refuseName() {
  let config: Record<string, unknown> = {};
  let hash = "h1";
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "users.self") return { profile: { id: "owner-1" } };
    if (method === "users.setDisplayName") throw new Error(TECHNICAL);
    if (method === "config.get") return { hash, valid: true, config };
    if (method === "config.patch") {
      config = merge(config, JSON.parse(String(params?.raw ?? "{}")));
      hash = `h${Number(hash.slice(1)) + 1}`;
      return { ok: true, hash, config };
    }
    return {};
  });
  const engine = {
    request,
    onEvent: () => () => undefined,
    sessionKey: null,
    agentId: "main",
    scopes: [],
    features: { methods: ["users.self", "users.setDisplayName", "config.get", "config.patch"], events: [] },
  } as unknown as WindowEngine;
  const execMode = () => {
    const tools = config.tools && typeof config.tools === "object" ? config.tools as { exec?: { mode?: unknown } } : undefined;
    return typeof tools?.exec?.mode === "string" ? tools.exec.mode : undefined;
  };
  return { engine, request, execMode };
}

async function showWelcome(engine: WindowEngine) {
  const onLater = vi.fn();
  await act(async () => root?.render(
    <CapabilityProvider engine={engine}><Onboarding engine={engine} onLater={onLater} /></CapabilityProvider>,
  ));
  await flush();
  return onLater;
}

async function typeName(value: string) {
  const box = host.querySelector('input[aria-label="Your name"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(box, value); box.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("uses the setup name in the greeting after a restart when there is no profile", async () => {
  const saving = engineWith(null);
  await saveDisplayName(saving.engine, "Ada Cole");
  // A restart drops the window session and keeps what was stored on this computer.
  sessionStorage.clear();
  expect(recalledSessionName()).toBe("Ada Cole");
  const shown = engineWith(null);
  await showChat({}, shown.engine);
  expect(greeting()!.textContent).toContain("Hi Ada, I’m Sapling.");
  expect(greeting()!.textContent).not.toContain("What should I call you");
  expect(shown.request).not.toHaveBeenCalledWith("users.setDisplayName", expect.anything());
});

it("stays on Welcome with a plain message when the name save fails, and Set up later still leaves", async () => {
  const { engine, execMode } = refuseName();
  const onLater = await showWelcome(engine);
  await typeName("Ada");
  await act(async () => button("Get started").click());
  await flush();
  expect(host.querySelector("h1")?.textContent).toBe("Hi, I’m Branch.");
  expect(host.querySelector("[role=alert]")?.textContent).toBe(PLAIN_NAME_ERROR);
  expect(host.textContent).not.toContain(TECHNICAL);
  expect(host.textContent).not.toContain("users.setDisplayName");
  expect(onLater).not.toHaveBeenCalled();
  expect(recalledSessionName()).toBe("Ada");

  await act(async () => button("Set up later").click());
  await flush();
  expect(onLater).toHaveBeenCalledOnce();
  expect(recalledSessionName()).toBe("Ada");
  expect(execMode()).toBe("ask");
  expect(host.textContent).not.toContain(TECHNICAL);
});

it("Escape leaves Welcome when the name save fails, keeps the name, and still saves Ask first", async () => {
  const { engine, execMode } = refuseName();
  const onLater = await showWelcome(engine);
  await typeName("Ada");
  await act(async () => {
    host.querySelector(".r1-ob")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await flush();
  expect(onLater).toHaveBeenCalledOnce();
  expect(recalledSessionName()).toBe("Ada");
  expect(execMode()).toBe("ask");
  expect(host.querySelector("[role=alert]")?.textContent).toBe(PLAIN_NAME_ERROR);
  expect(host.textContent).not.toContain(TECHNICAL);
});
