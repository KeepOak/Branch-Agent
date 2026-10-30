// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { ChatView, type ChatViewProps } from "./ChatView";
import { rememberSessionName } from "../onboarding/session-name";
import { DEFAULT_TRUNK_WHY, EXAMPLES_GREETING_KEY, examplesGreetingText } from "./examples-greeting";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  rememberSessionName("");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

function engineWith(name: string | null) {
  const request = vi.fn(async (method: string) => (method === "users.self" && name !== null ? { profile: { displayName: name } } : {}));
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], features: { methods: ["users.self", "chat.send"], events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
async function show(props: Partial<ChatViewProps>, engine?: WindowEngine) {
  const view = <ChatView name="Sapling" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey="agent:main:main" examplesWhy={DEFAULT_TRUNK_WHY} {...props} />;
  await act(async () => root.render(engine ? <CapabilityProvider engine={engine}>{view}</CapabilityProvider> : view));
  await flush();
}
const greeting = () => host.querySelector<HTMLElement>(`[data-block-key="${EXAMPLES_GREETING_KEY}"]`);

it("the greeting text is the preview's examples greeting, with the person's first name and the Trunk's name", () => {
  expect(examplesGreetingText("Ada", "Sapling", DEFAULT_TRUNK_WHY)).toBe(
    "Hi Ada, I’m Sapling. I’m your default Trunk, the one with the leaf. I take new conversations and anything nobody else has. You’re trying Branch with examples, so my replies are examples until you add a model.\n\nWhat are you working on right now?",
  );
  expect(examplesGreetingText("Ada", "Sapling", DEFAULT_TRUNK_WHY)).not.toContain("What should I call you");
  expect(examplesGreetingText("", "Sapling", DEFAULT_TRUNK_WHY)).toMatch(/^Hi, I’m Sapling\. /);
  expect(examplesGreetingText("", "Sapling", DEFAULT_TRUNK_WHY)).toContain("What should I call you");
});

it("an examples conversation with no messages shows the greeting in place of the empty state, and sends nothing", async () => {
  const { engine, request } = engineWith("Ada");
  await show({}, engine);
  expect(host.querySelector('[data-testid="empty-chat"]')).toBeNull();
  expect(greeting()).not.toBeNull();
  expect(greeting()!.textContent).toContain("Hi Ada, I’m Sapling.");
  expect(greeting()!.textContent).toContain("You’re trying Branch with examples");
  expect(greeting()!.textContent).not.toContain("What should I call you");
  expect(greeting()!.querySelector(".r1c-hover, [data-testid='hover-bar']")).toBeNull();
  expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
});

it("the greeting is left out once the conversation has messages, and in an ordinary conversation", async () => {
  const history: Block[] = [{ kind: "user", key: "u1", text: "Hello" }];
  await show({ history });
  expect(greeting()).toBeNull();
  await show({ examplesWhy: undefined });
  expect(greeting()).toBeNull();
  expect(host.querySelector('[data-testid="empty-chat"]')).not.toBeNull();
});

it("uses the name from setup when this connection has no profile", async () => {
  rememberSessionName("Ada Cole");
  const { engine } = engineWith(null);
  await show({}, engine);
  expect(greeting()!.textContent).toContain("Hi Ada, I’m Sapling.");
  expect(greeting()!.textContent).not.toContain("What should I call you");
});

it("the greeting waits for the history to be read", async () => {
  await show({ historyReady: false });
  expect(greeting()).toBeNull();
  expect(host.querySelector('[data-testid="opening"]')).not.toBeNull();
});
