// @vitest-environment jsdom
// Issue 1814 (chat slice): the chat still showed the engine's raw words at Regular in "Couldn't retry", "Couldn't load
// earlier pages", an earlier page's failed step and the failure toasts of Thread and ChatView. At Regular each now reads
// as one plain sentence (plainError); Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../connect/capabilities";
import type { WindowEngine } from "../connect/engine";
import { ChatView } from "../screens/chat/ChatView";
import type { Block } from "./model";
import { Thread } from "./Thread";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const RAW_WORDS = "connect ECONNREFUSED 127.0.0.1:18789";
const PLAIN = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const RAW = /ECONNREFUSED|127\.0\.0\.1|18789/;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const advanced = () => localStorage.setItem("branch.level", "advanced");

/** An engine whose failing methods reject with the raw words; answers gives other methods' results. */
function engineWith(failing: string[], answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (failing.includes(method)) throw new Error(RAW_WORDS);
    return answers[method] ?? {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "agent:oak:main", agentId: "oak", scopes: ["operator.admin"],
    features: { methods: ["exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "question.list", "agents.list", "agents.retryStartup", "sessions.fork", "chat.send"], events: [] } } as unknown as WindowEngine;
}
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label) ?? null;

describe("Thread: the chat's failure lines and toasts at Regular and Advanced (#1814)", () => {
  const thread = (props: Partial<Parameters<typeof Thread>[0]> = {}) => act(async () => root.render(
    <Thread name="Oak" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} {...props} />));

  it("Couldn't load earlier pages reads as a plain sentence at Regular and keeps the exact words at Advanced", async () => {
    await thread({ earlierError: RAW_WORDS });
    expect(host.textContent).toContain("Couldn't load earlier pages. " + PLAIN);
    expect(host.textContent).not.toMatch(RAW);
    advanced();
    await act(async () => root.unmount());
    root = createRoot(host);
    await thread({ earlierError: RAW_WORDS });
    expect(host.textContent).toContain("Couldn't load earlier pages: " + RAW_WORDS);
  });

  it("an earlier page's failed step shows a plain sentence, and a raw output is left out, at Regular only", async () => {
    const page = { sessionId: "s-old", startedAt: 1_000, blocks: [
      { kind: "step", key: "a", tool: "exec", title: "Ran the tests", detail: RAW_WORDS, status: "failed" },
      { kind: "step", key: "b", tool: "read", title: "Read the notes", detail: "ENOENT: no such file or directory, open '/app/notes.md'", status: "ok" },
    ] as Block[] };
    await thread({ earlierPages: [page] });
    const lines = () => [...host.querySelectorAll(".segment-line span")].map((n) => n.textContent);
    expect(lines()).toEqual(["Ran the tests · " + PLAIN, "Read the notes"]);
    advanced();
    await act(async () => root.unmount());
    root = createRoot(host);
    await thread({ earlierPages: [page] });
    expect(lines()).toEqual(["Ran the tests · " + RAW_WORDS, "Read the notes · ENOENT: no such file or directory, open '/app/notes.md'"]);
  });

  it("Couldn't retry reads as a plain sentence at Regular", async () => {
    const engine = engineWith(["agents.retryStartup"], { "agents.list": { agents: [{ id: "oak", admissionRefusal: { code: "agent-database-inspection-pending", preparation: { state: "needs-attention" } } }] } });
    await thread({ engine, sessionKey: engine.sessionKey, preparationError: "Oak is still starting up. Try again in a minute." });
    await flush();
    await act(async () => button("Retry")!.click());
    await flush();
    const alert = host.querySelector('[data-testid="preparation-status"] [role="alert"]');
    expect(alert?.textContent).toBe("Couldn't retry. " + PLAIN);
  });

  it("a failed Resume toasts a plain sentence at Regular and the exact words at Advanced", async () => {
    const engine = engineWith(["sessions.fork"]);
    const toast = vi.fn();
    const history: Block[] = [{ kind: "user", key: "m", text: "Build it", meta: { entryId: "entry-1" } }];
    await thread({ engine, sessionKey: engine.sessionKey, history, recoveryFailure: "Interrupted by a restart. Continue?", onToast: toast });
    await act(async () => button("Resume")!.click());
    await flush();
    expect(toast).toHaveBeenLastCalledWith(PLAIN);
    advanced();
    await act(async () => button("Resume")!.click());
    await flush();
    expect(toast).toHaveBeenLastCalledWith(RAW_WORDS);
  });
});

describe("ChatView: a failed Always allow toasts plain words at Regular (#1814)", () => {
  it("toasts a plain sentence at Regular and the exact words at Advanced", async () => {
    const pending = { id: "ap1", sessionKey: "agent:oak:main", agentId: "oak",
      request: { command: "npm test", cwd: "/work/site", host: "gateway", sessionKey: "agent:oak:main", agentId: "oak", allowedDecisions: ["allow-once", "allow-always", "deny"] } };
    const engine = engineWith(["exec.approval.resolve"], { "exec.approval.list": { approvals: [pending] }, "question.list": { questions: [] } });
    const toast = vi.fn();
    const history: Block[] = [
      { kind: "user", key: "u1", text: "Run the tests." },
      { kind: "approval", key: "approval:ap1", approval: { id: "ap1", command: "npm test", state: "pending" } },
    ];
    const show = () => act(async () => root.render(<CapabilityProvider engine={engine}>
      <ChatView name="Oak" history={history} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey={engine.sessionKey} onToast={toast} />
    </CapabilityProvider>));
    await show();
    await flush();
    await act(async () => button("Always allow for Oak")!.click());
    await flush();
    expect(toast).toHaveBeenLastCalledWith(PLAIN);
    advanced();
    await act(async () => button("Always allow for Oak")!.click());
    await flush();
    expect(toast).toHaveBeenLastCalledWith(RAW_WORDS);
  });
});
