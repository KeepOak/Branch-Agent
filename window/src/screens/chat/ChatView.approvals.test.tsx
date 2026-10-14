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
function engineWith(resolve: (method: string) => Promise<unknown> | unknown, items: unknown[] = [pending]) {
  const request = vi.fn(async (method: string) => {
    if (method === "exec.approval.list") return { approvals: items };
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

const second = {
  id: "ap2", sessionKey: "agent:scout:main", agentId: "scout",
  request: { command: "npm run lint", cwd: "/work/site", host: "gateway", sessionKey: "agent:scout:main", agentId: "scout", allowedDecisions: ["allow-once", "allow-always", "deny"] },
};
const twoBlocks: Block[] = [
  { kind: "user", key: "u1", text: "Test and lint." },
  { kind: "approval", key: "approval:ap1", approval: { id: "ap1", command: "npm test", state: "pending" } },
  { kind: "approval", key: "approval:ap2", approval: { id: "ap2", command: "npm run lint", state: "pending" } },
];
const groupCard = () => host.querySelector<HTMLElement>('[data-testid="r1-ask-group"]');
const groupRow = (id: string) => host.querySelector<HTMLElement>(`[data-testid="r1-ask-group-row"][data-approval="${id}"]`);
const groupButton = (id: string, label: string) => [...groupRow(id)!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label) ?? null;

it("two approvals in one conversation show as the preview's group card, with no single cards", async () => {
  const { engine } = engineWith(() => ({}), [pending, second]);
  await show(engine, false, twoBlocks);
  expect(groupCard()).not.toBeNull();
  expect(groupCard()!.querySelector(".r1-ask-q")!.textContent).toBe("Two things need you");
  expect(groupCard()!.querySelector(".r1-ask-head .r1-ask-pill")!.textContent).toBe("Waiting for you");
  expect(groupRow("ap1")!.textContent).toContain("npm test");
  expect(groupRow("ap2")!.textContent).toContain("npm run lint");
  expect(groupButton("ap1", "Yes")).not.toBeNull();
  expect(groupButton("ap1", "No")).not.toBeNull();
  expect(button("Yes to both")).not.toBeNull();
  expect(host.querySelector('[data-testid="r1-ask"]')).toBeNull();
});

it("Yes on one row answers only that approval, and Yes to both answers each waiting one", async () => {
  const { engine, request } = engineWith(() => ({}), [pending, second]);
  await show(engine, false, twoBlocks);
  await act(async () => groupButton("ap1", "Yes")!.click());
  await flush();
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap1", decision: "allow-once" }));
  expect(request).not.toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap2" }));
  expect(groupRow("ap1")!.textContent).toContain("Allowed");
  expect(groupRow("ap2")).not.toBeNull();
  // The group keeps the answered row; the one left waiting is still answerable.
  expect(groupButton("ap2", "Yes")).not.toBeNull();
});

it("Yes to both sends an allow-once for each waiting approval", async () => {
  const { engine, request } = engineWith(() => ({}), [pending, second]);
  await show(engine, false, twoBlocks);
  await act(async () => button("Yes to both")!.click());
  await flush();
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap1", decision: "allow-once" }));
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap2", decision: "allow-once" }));
});

it("under Lockdown the group's Yes buttons are disabled and No still works", async () => {
  const { engine, request } = engineWith(() => ({}), [pending, second]);
  await show(engine, true, twoBlocks);
  expect(groupButton("ap1", "Yes")!.disabled).toBe(true);
  expect(button("Yes to both")!.disabled).toBe(true);
  expect(groupButton("ap1", "No")!.disabled).toBe(false);
  await act(async () => groupButton("ap2", "No")!.click());
  await flush();
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap2", decision: "deny" }));
});
