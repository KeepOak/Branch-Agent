// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thread } from "./Thread";
import { topicPosition } from "./TopicCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

const topic: Topic = { key: "agent:oak:topic", contactId: "trunk:oak", title: "Research", anchor: { threadKey: "agent:oak:main", afterMessageId: "first", at: 100 }, status: "active", unread: true };
const history = [
  { kind: "user" as const, key: "first", text: "Begin", meta: { timestamp: 100 } },
  { kind: "text" as const, key: "middle", text: "Main reply", streaming: false, meta: { timestamp: 200 } },
];

describe("topic update in the contact thread", () => {
  it("keeps the origin at its anchor while a newer reply moves the update card", () => {
    expect(topicPosition(history, 100, "first")).toBe(0);
    expect(topicPosition(history, 150)).toBe(0);
    expect(topicPosition(history, 250)).toBe(1);
  });

  it("renders a clickable update card at the preview position and scrolls to it", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    const open = vi.fn();
    const other = { ...topic, key: "agent:oak:older", title: "Older", anchor: { threadKey: "agent:oak:main", at: 90 } };
    await act(async () => root!.render(<Thread name="Oak" history={history} live={[]} pendingUser={null} running={false} onAnswer={() => {}} onOpenSession={open}
      topicUpdates={[{ topic, text: "Topic reply", at: 250, unread: true }, { topic: other, text: "Earlier reply", at: 220, unread: false }]} focusTopic={{ key: topic.key, nonce: 1 }} />));
    const origin = [...container.querySelectorAll<HTMLButtonElement>(".topic-origin")].find((node) => node.textContent?.includes("Research"))!;
    const card = container.querySelector<HTMLButtonElement>(`[data-testid="topic-card-${topic.key}"]`)!;
    expect(origin.textContent).toContain("Started a conversation: Research");
    expect(card.textContent).toContain("Topic reply");
    expect(origin.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll(".topic-update")[1]).toBe(card);
    expect(scroll).toHaveBeenCalled();
    await act(async () => card.click());
    expect(open).toHaveBeenCalledWith(topic.key);
  });
});
