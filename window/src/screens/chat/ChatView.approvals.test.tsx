// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { ChatView } from "./ChatView";
import { useAsks } from "../approvals";

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
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

const METHODS = ["exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "question.list"];
/** The engine lists one pending exec approval for this conversation. `resolve` decides what an answer does. */
function engineWith(resolve: (method: string) => Promise<unknown> | unknown) {
  const request = vi.fn(async (method: string) => {
    if (method === "exec.approval.list") return { approvals: [pending] };
    return resolve(method);
  });
  return { request, engine: { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine };
}
const pending = {
  id: "ap1", sessionKey: "agent:scout:main", agentId: "scout",
  request: { command: "npm test", cwd: "/work/site", host: "gateway", sessionKey: "agent:scout:main", agentId: "scout", allowedDecisions: ["allow-once", "allow-always", "deny"] },
};
const history: Block[] = [
  { kind: "user", key: "u1", text: "Run the tests." },
  { kind: "approval", key: "approval:ap1", approval: { id: "ap1", command: "npm test", state: "pending" } },
];

function Harness({ engine, lockdown, blocks }: { engine: WindowEngine; lockdown: boolean; blocks: Block[] }) {
  const approvals = useAsks(engine, lockdown);
  return <CapabilityProvider engine={engine}>
    <ChatView name="Scout" history={blocks} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey={engine.sessionKey}
      asks={approvals.asks} onAsk={(id, reply) => void approvals.answer(id, reply)} lockdown={lockdown} />
  </CapabilityProvider>;
}
async function show(engine: WindowEngine, lockdown = false, blocks = history) {
  await act(async () => root.render(<Harness engine={engine} lockdown={lockdown} blocks={blocks} />));
  await flush();
}
/** The approval's card: the live card, or its decided line once answered (the only r1-ask in these tests). */
const card = () => host.querySelector<HTMLElement>('[data-testid="r1-ask"]');
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".r1-ask-btn")].find(b => b.textContent === label) ?? null;

it("draws the R1 approval card in the conversation, with its question, facts and answers and no Classic extras", async () => {
  const { engine } = engineWith(() => ({}));
  await show(engine);
  expect(card()?.getAttribute("data-state")).toBe("waiting");
  expect(card()!.textContent).toContain("Run this command?");
  expect(card()!.textContent).toContain("/work/site");
  expect(button("Allow")).not.toBeNull();
  expect(button("Always allow for Scout")).not.toBeNull();
  expect(button("Deny")).not.toBeNull();
  expect(host.textContent).not.toContain("Show command");
  expect(host.querySelector(".card.ask, .card-buttons, .g-acts")).toBeNull();
});

it("Allow sends exec.approval.resolve allow-once and collapses the card to its decided line", async () => {
  const { engine, request } = engineWith(() => ({}));
  await show(engine);
  await act(async () => button("Allow")!.click());
  await flush();
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap1", decision: "allow-once" }));
  expect(card()?.getAttribute("data-state")).toBe("allow-once");
  expect(card()!.textContent).toContain("✓ Allowed");
});

it("Deny sends exec.approval.resolve deny and shows Declined", async () => {
  const { engine, request } = engineWith(() => ({}));
  await show(engine);
  await act(async () => button("Deny")!.click());
  await flush();
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap1", decision: "deny" }));
  expect(card()!.textContent).toContain("✕ Declined");
});

it("under Lockdown Allow is disabled and Deny still works", async () => {
  const { engine, request } = engineWith(() => ({}));
  await show(engine, true);
  expect(button("Allow")!.disabled).toBe(true);
  expect(button("Always allow for Scout")!.disabled).toBe(true);
  expect(button("Deny")!.disabled).toBe(false);
  await act(async () => button("Allow")!.click());
  expect(request).not.toHaveBeenCalledWith("exec.approval.resolve", expect.anything());
});

it("a failed answer stays open with the error under the buttons, and can be tried again", async () => {
  const { engine } = engineWith((method) => { if (method === "exec.approval.resolve") throw new Error("Engine is busy"); return {}; });
  await show(engine);
  await act(async () => button("Allow")!.click());
  await flush();
  expect(card()?.getAttribute("data-state")).toBe("waiting");
  expect(card()!.querySelector('[role="alert"]')!.textContent).toContain("Engine is busy");
  expect(button("Allow")!.disabled).toBe(false);
});

it("an ask for this conversation with no approval block still gets its card at the foot of the thread", async () => {
  const { engine } = engineWith(() => ({}));
  await show(engine, false, [{ kind: "user", key: "u1", text: "Run the tests." }]);
  expect(card()?.getAttribute("data-state")).toBe("waiting");
});
