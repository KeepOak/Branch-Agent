// @vitest-environment jsdom
// Where your own messages sit in the thread (live-findings 1, 2, 5, 12): a message the running turn picked up sits over
// that turn, a steer is a note inside its turn (one Steps fold, one Done line), and a message that never went says so.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { QueuedMessage } from "../connect/session";
import { historyToBlocks } from "./history";
import { layout } from "./layout";
import type { Block } from "./model";
import { Thread } from "./Thread";
import { loadLine, saveLine } from "../composer/queue";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
let root: Root | undefined;
afterEach(async () => { localStorage.clear(); if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const KEY = "agent:main:main";
const engine: WindowEngine = {
  sessionKey: KEY, scopes: [], onEvent: () => () => {},
  request: (async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    return {};
  }) as WindowEngine["request"],
};

async function render(props: Partial<Parameters<typeof Thread>[0]>) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Thread name="Juniper" history={[]} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} {...props} />));
  return container;
}

const order = (container: HTMLElement, selectors: string[]) => {
  const all = [...container.querySelectorAll(selectors.join(","))];
  return selectors.map((s) => all.findIndex((el) => el.matches(s)));
};

const RUN = "run-1";
/** The steer run as the engine keeps it (live-findings 12): two commands, a message steered in between, the answer. */
const steeredHistory = [
  { role: "user", content: "Run two commands", timestamp: 1_000, idempotencyKey: `${RUN}:user` },
  { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "sleep 12; echo one" } }], stopReason: "toolUse", timestamp: 2_000, __branch: { runId: RUN } },
  { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "one" }], timestamp: 14_000, __branch: { runId: RUN } },
  { role: "user", content: "Also run echo three before you answer.", timestamp: 10_000, __branch: { steerTargetRunId: RUN } },
  { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "echo three" } }], stopReason: "toolUse", timestamp: 15_000, __branch: { runId: RUN } },
  { role: "toolResult", toolCallId: "c2", content: [{ type: "text", text: "three" }], timestamp: 16_000, __branch: { runId: RUN } },
  { role: "assistant", content: [{ type: "text", text: "one three" }], stopReason: "stop", timestamp: 17_000, __branch: { runId: RUN } },
];

describe("your own messages in the thread", () => {
  it("keeps a steered message inside its turn: one Steps fold, then the steered note, one Done line", async () => {
    const history = historyToBlocks(steeredHistory, [], KEY, null);
    expect(history.map((b) => b.kind)).toEqual(["user", "step", "steer", "step", "text", "done"]);
    expect(layout(history).map((item) => (item.type === "steps" ? `steps:${item.steps.length}` : item.block.kind))).toEqual(["user", "steps:2", "steer", "text", "done"]);
    const container = await render({ history });
    expect(container.querySelectorAll('[data-testid="message"][data-role="user"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="steered-note"]')?.textContent).toBe(
      "You steered Juniper: “Also run echo three before you answer.”. It takes this at its next step; nothing done so far is lost.",
    );
    expect(container.querySelectorAll('[data-testid="run-done"]')).toHaveLength(1);
  });

  it("draws a message the running turn picked up over that turn, and one still waiting after it", async () => {
    const block = (text: string): Extract<Block, { kind: "user" }> => ({ kind: "user", key: text, text });
    const queued: QueuedMessage[] = [
      { key: "q:picked", block: block("Picked up"), state: "delivered" },
      { key: "q:waiting", block: block("Still waiting"), state: "queued" },
    ];
    const container = await render({ queued, running: true, live: [] });
    const rows = [...container.querySelectorAll('[data-testid="queued-message"]')];
    const typing = container.querySelector('[data-testid="typing"]')!;
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["delivered", "queued"]);
    expect(rows[0]!.compareDocumentPosition(typing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[1]!.compareDocumentPosition(typing) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("shows the first message of an empty conversation at once and drops the empty page", async () => {
    const container = await render({ pendingUser: "What is 2+3? Answer in one word.", running: true });
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(container.textContent).not.toContain("What should");
    expect(container.querySelector('[data-testid="message"][data-role="user"]')?.textContent).toContain("What is 2+3? Answer in one word.");
    expect(container.querySelector('[data-testid="typing"]')).toBeTruthy();
  });

  it("puts your message over the new reply, with only one copy of it, while the turn runs", async () => {
    const container = await render({ pendingUser: "Write an essay", running: true, live: [{ kind: "text", key: "t", text: "Lighthouses", streaming: true }] });
    expect(container.querySelectorAll('[data-testid="message"][data-role="user"]')).toHaveLength(1);
    const [user, reply] = order(container, ['[data-testid="message"][data-role="user"]', '[data-testid="message"][data-role="assistant"]']);
    expect(user).toBeLessThan(reply!);
  });

  it("shows live steered notes under the turn", async () => {
    const container = await render({ pendingUser: "Run two commands", running: true, steered: [{ runId: "s1", text: "Also echo three", target: "r1" }] });
    expect(container.querySelector('[data-testid="steered-note"]')?.textContent).toContain("You steered Juniper: “Also echo three”.");
  });

  it("shows a Not sent message from the waiting line with the reason; Try again puts it back in line, Discard removes it", async () => {
    saveLine(localStorage, KEY, [{ id: "r", text: "Say hi", files: [], state: "failed", error: "Error: Session database changed while waiting for admission" }]);
    const container = await render({ sessionKey: KEY });
    const row = container.querySelector('[data-testid="not-sent"]')!;
    expect(row.textContent).toContain("Say hi");
    expect(row.querySelector(".pill.bad")?.textContent).toBe("Not sent");
    expect(row.querySelector(".send-why")?.textContent).toBe("Session database changed while waiting for admission");
    expect(container.textContent).not.toContain("What should");
    await act(async () => [...row.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click());
    expect(loadLine(localStorage, KEY)).toMatchObject([{ id: "r", state: "waiting" }]);
    saveLine(localStorage, KEY, [{ id: "r", text: "Say hi", files: [], state: "failed", error: "x" }]);
    await act(async () => {});
    await act(async () => [...container.querySelectorAll('[data-testid="not-sent"] button')].find((b) => b.textContent === "Discard")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(loadLine(localStorage, KEY)).toEqual([]);
  });
});
