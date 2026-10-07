// @vitest-environment jsdom
// The thread draws waiting messages at once: an outside agent's queued post with its own face and name, and this
// window's own waiting line, each marked "Queued"; the owner's message a turn picked up says "Delivered".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeQueued } from "../connect/session";
import { loadLine, nextToSend, saveLine } from "../composer/queue";
import { QueuedMessages, useOwnWaitingLine } from "./QueuedMessages";

const KEY = "agent:lead:main";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const room = { isRoom: true, selfId: null, trunkName: (id: string) => id, whereRuns: () => "LEGION", isOnline: () => true };
const post = {
  id: "pending:p1",
  state: "queued",
  acceptedAt: 1,
  message: { role: "user", content: "Ship it", timestamp: 1, __branch: { id: "pending:p1", senderId: "claude-code-a1b2c3", senderName: "Claude Code", senderIdentity: { type: "observation", id: "claude-code-a1b2c3", pluginId: "a2a", accountId: "mcp", senderKind: "bot" } } },
};

function Own() {
  const own = useOwnWaitingLine(KEY);
  return <QueuedMessages queued={mergeQueued([], { items: [post] }, KEY, false)} own={own} room={room} />;
}

describe("waiting messages in the thread", () => {
  it("shows an agent's queued post as that agent, and this window's waiting line live, all marked Queued", async () => {
    await act(async () => root.render(<Own />));
    let rows = [...host.querySelectorAll('[data-testid="queued-message"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Ship it");
    expect(rows[0]!.textContent).toContain("Claude Code");
    expect(rows[0]!.querySelector(".queue-mark")?.textContent).toBe("Queued");

    await act(async () => saveLine(localStorage, KEY, [{ id: "o1", text: "And add tests", files: [], state: "waiting" }]));
    rows = [...host.querySelectorAll('[data-testid="queued-message"]')];
    expect(rows.map((r) => r.querySelector(".queue-mark")?.textContent)).toEqual(["Queued", "Queued"]);
    expect(rows[1]!.textContent).toContain("And add tests");

    await act(async () => saveLine(localStorage, KEY, []));
    expect(host.querySelectorAll('[data-testid="queued-message"]')).toHaveLength(1);
  });

  it("draws a message sent but not confirmed as Not confirmed yet, and holds the line behind it", async () => {
    saveLine(localStorage, KEY, [
      { id: "lost", text: "Did this arrive?", files: [], state: "checking" },
      { id: "next", text: "After it", files: [], state: "waiting" },
    ]);
    await act(async () => root.render(<QueuedMessages queued={[]} own={loadLine(localStorage, KEY)} />));
    const rows = [...host.querySelectorAll('[data-testid="queued-message"]')];
    expect(rows.map((r) => [r.getAttribute("data-state"), r.querySelector(".queue-mark")?.textContent])).toEqual([
      ["checking", "Not confirmed yet"],
      ["queued", "Queued"],
    ]);
    expect(host.querySelector('[data-testid="not-sent"]')).toBeNull();
    expect(nextToSend(loadLine(localStorage, KEY))).toBeUndefined();
  });

  it("marks a picked-up post Delivered", async () => {
    const delivered = mergeQueued(mergeQueued([], { items: [post] }, KEY, false), { items: [] }, KEY, false);
    await act(async () => root.render(<QueuedMessages queued={delivered} own={[]} room={room} />));
    expect(host.querySelector(".queue-mark")?.textContent).toBe("Delivered");
    expect(host.querySelector('[data-testid="queued-message"]')?.getAttribute("data-state")).toBe("delivered");
  });
});
