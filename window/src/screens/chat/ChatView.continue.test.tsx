// @vitest-environment jsdom
// Private #1102 (Hermes A-179): after Stop, the conversation says "Response stopped", and the latest stopped turn offers
// Continue. Continue sends through chat.send (the engine keeps the stopped reply's partial, so the Trunk resumes from it).
// Without chat.send, or when nothing of the reply was kept, there is no Continue: the line stands alone and "Carry on" stays.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { ChatView, CONTINUE_MESSAGE, type ChatViewProps } from "./ChatView";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const engineWith = (methods: string[]): WindowEngine => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } }) as WindowEngine;
const t0 = new Date(2026, 9, 16, 12, 0).getTime();
const stoppedTurn = (n: number): Block[] => [
  { kind: "user", key: `u${n}`, text: "Tell me a story about a cat.", meta: { entryId: `e${n}`, timestamp: t0 + n } },
  { kind: "text", key: `a${n}`, text: "A young camel, curious about his red thread, bent", streaming: false, meta: { entryId: `f${n}`, timestamp: t0 + n + 1 } },
  { kind: "done", key: `r${n}:done`, runId: `r${n}`, stopped: true },
];
async function show(props: Partial<ChatViewProps>, methods: string[]) {
  const engine = engineWith(methods);
  await act(async () => root.render(<CapabilityProvider engine={engine}><ChatView name="Scout" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey={engine.sessionKey} {...props} /></CapabilityProvider>));
}
const stopped = () => [...host.querySelectorAll('[data-testid="run-stopped"]')];
const continueButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Continue");

it("says Response stopped, and Continue resumes the turn through chat.send", async () => {
  const onStart = vi.fn();
  await show({ history: stoppedTurn(1), onStart }, ["chat.send"]);
  expect(stopped().map((line) => line.querySelector(".r1c-notice-text")?.textContent)).toEqual(["Response stopped"]);
  expect(host.textContent).not.toContain("Stopped · what it did so far is kept.");
  const button = continueButton();
  expect(button).toBeDefined();
  expect(button!.closest('[data-need="chat.send"], [data-coming]')?.getAttribute("data-coming") ?? null).toBeNull();
  // One way to resume: no "Carry on" chip beside Continue.
  expect(host.querySelector('[data-testid="suggestion-row"]')).toBeNull();
  await act(async () => button!.click());
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onStart).toHaveBeenCalledWith(CONTINUE_MESSAGE);
  expect(CONTINUE_MESSAGE).toBe("Continue");
  expect(continueButton()).toBeUndefined();
});

it("offers Continue only on the latest stopped turn, and not while a run works", async () => {
  const onStart = vi.fn();
  await show({ history: [...stoppedTurn(1), ...stoppedTurn(2)], onStart }, ["chat.send"]);
  expect(stopped()).toHaveLength(2);
  const withContinue = stopped().filter((line) => [...line.querySelectorAll("button")].some((b) => b.textContent === "Continue"));
  expect(withContinue).toEqual([stopped()[1]]);
  await show({ history: stoppedTurn(1), onStart, running: true }, ["chat.send"]);
  expect(continueButton()).toBeUndefined();
  await show({ history: stoppedTurn(1), onStart, pendingUser: "and then?" }, ["chat.send"]);
  expect(continueButton()).toBeUndefined();
});

it("an engine without chat.send shows no Continue and no Coming row, only the Response stopped line", async () => {
  const onStart = vi.fn();
  await show({ history: stoppedTurn(1), onStart }, []);
  expect(stopped().map((line) => line.querySelector(".r1c-notice-text")?.textContent)).toEqual(["Response stopped"]);
  expect(continueButton()).toBeUndefined();
  expect(stopped()[0].querySelector("[data-coming]")).toBeNull();
  expect(host.textContent).not.toContain("Continue comes in a later update.");
  expect(onStart).not.toHaveBeenCalled();
});

it("a stop that kept nothing of the reply offers no Continue, and the Carry on chip stays", async () => {
  const onStart = vi.fn();
  const earlier: Block[] = [
    { kind: "user", key: "u0", text: "Hi", meta: { entryId: "e0", timestamp: t0 } },
    { kind: "text", key: "a0", text: "Hello there.", streaming: false, meta: { entryId: "f0", timestamp: t0 + 1 } },
    { kind: "done", key: "r0:done", runId: "r0", stopped: false },
  ];
  const blank: Block[] = [
    { kind: "user", key: "u1", text: "Tell me a story about a cat.", meta: { entryId: "e1", timestamp: t0 + 2 } },
    { kind: "done", key: "r1:done", runId: "r1", stopped: true },
  ];
  await show({ history: [...earlier, ...blank], onStart }, ["chat.send"]);
  expect(stopped().map((line) => line.querySelector(".r1c-notice-text")?.textContent)).toEqual(["Response stopped"]);
  expect(continueButton()).toBeUndefined();
  const chips = [...host.querySelectorAll('[data-testid="suggestion-row"] button')].map((b) => b.textContent);
  expect(chips).toEqual(["“Carry on”"]);
});
