// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadContext } from "./context";
import { Thread } from "./Thread";
import { TopicCard, topicPosition, type TopicUpdate } from "./TopicCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

const topic: Topic = { key: "agent:oak:topic", contactId: "trunk:oak", title: "Research", anchor: { threadKey: "agent:oak:main", afterMessageId: "first", at: 100 }, status: "active", unread: true };
const history = [
  { kind: "user" as const, key: "first", text: "Begin", meta: { timestamp: 100 } },
  { kind: "text" as const, key: "middle", text: "Main reply", streaming: false, meta: { timestamp: 200 } },
];

function topicOf(status: Topic["status"], extra: Partial<Topic> = {}): Topic {
  return { key: "agent:oak:job", contactId: "trunk:oak", title: "Watch Lisbon fares", status, unread: false, ...extra };
}

function updateOf(status: Topic["status"], extra: Partial<TopicUpdate> = {}, topicExtra: Partial<Topic> = {}): TopicUpdate {
  return { topic: topicOf(status, topicExtra), text: "Checking twice a day.", at: Date.parse("2026-10-08T11:20:00Z"), unread: false, ...extra };
}

async function renderCard(update: TopicUpdate, onOpen = vi.fn(), name = "Oak") {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(
    <ThreadContext.Provider value={{ name, toast: () => undefined, running: false }}>
      <TopicCard update={update} onOpen={onOpen} />
    </ThreadContext.Provider>,
  ));
  return { container, onOpen };
}

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
    const card = container.querySelector<HTMLElement>(`[data-testid="topic-card-${topic.key}"]`)!;
    expect(origin.textContent).toContain("Started a thread: Research");
    expect(card.textContent).toContain("Topic reply");
    expect(origin.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll(".jobT5")[1]).toBe(card);
    expect(scroll).toHaveBeenCalled();
    const top = card.querySelector<HTMLButtonElement>(".jobTopT5")!;
    await act(async () => top.click());
    const openBtn = [...card.querySelectorAll("button")].find((node) => node.textContent === "Open the conversation")!;
    await act(async () => openBtn.click());
    expect(open).toHaveBeenCalledWith(topic.key);
  });
});

describe("job card in the chat", () => {
  it("a working topic shows the spinner, the working pill and the progress bar", async () => {
    const { container } = await renderCard(updateOf("working"));
    expect(container.querySelector(".spinT5")).toBeTruthy();
    expect(container.querySelector(".pillT5")?.textContent).toBe("working");
    expect(container.querySelector(".barT5")).toBeTruthy();
    expect(container.textContent).toContain("Oak");
  });

  it("waiting reads needs your yes", async () => {
    const { container } = await renderCard(updateOf("waiting", { text: "Needs your yes to save." }));
    expect(container.querySelector(".pillT5")?.textContent).toBe("needs your yes");
    expect(container.querySelector(".spinT5")).toBeNull();
    expect(container.querySelector(".barT5")).toBeNull();
  });

  it("active never shows active and never shows the spinner", async () => {
    const { container } = await renderCard(updateOf("active", { text: "Still open." }));
    expect(container.textContent).not.toMatch(/\bactive\b/);
    expect(container.querySelector(".spinT5")).toBeNull();
    expect(container.querySelector(".pillT5")?.textContent).toBe("open");
    expect(container.querySelector(".barT5")).toBeNull();
  });

  it("state stuck with a reason shows stuck and the reason", async () => {
    const { container } = await renderCard(updateOf("working", { state: "stuck", reason: "The helper stopped.", text: "Checking twice a day." }));
    expect(container.querySelector(".pillT5")?.textContent).toBe("stuck");
    expect(container.textContent).toContain("The helper stopped.");
    expect(container.textContent).not.toContain("Checking twice a day.");
    expect(container.querySelector(".spinT5")).toBeNull();
  });

  it("clicking the top toggles aria-expanded and shows the body", async () => {
    const { container } = await renderCard(updateOf("done", { text: "14 of 14 matched." }));
    const top = container.querySelector<HTMLButtonElement>(".jobTopT5")!;
    const body = container.querySelector<HTMLElement>(".jobBodyT5")!;
    expect(top.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    await act(async () => top.click());
    expect(top.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    expect(container.querySelector(".jobT5")?.classList.contains("open")).toBe(true);
    await act(async () => top.click());
    expect(top.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
  });

  it("Open the conversation calls onOpen with the key", async () => {
    const { container, onOpen } = await renderCard(updateOf("done", {}, { key: "agent:oak:receipts" }));
    const top = container.querySelector<HTMLButtonElement>(".jobTopT5")!;
    await act(async () => top.click());
    const openBtn = [...container.querySelectorAll("button")].find((node) => node.textContent === "Open the conversation")!;
    await act(async () => openBtn.click());
    expect(onOpen).toHaveBeenCalledWith("agent:oak:receipts");
  });

  it("data-testid is kept", async () => {
    const { container } = await renderCard(updateOf("done", {}, { key: "agent:oak:kept" }));
    expect(container.querySelector(`[data-testid="topic-card-agent:oak:kept"]`)).toBeTruthy();
  });
});
