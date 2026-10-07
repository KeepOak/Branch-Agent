// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopicRail, shortTopicTitle } from "./TopicRail";
import { patchTopicSession } from "./topic-session";
import { topicEmoji } from "./topic-emoji-logic";
import { mergeTopicTranscripts } from "./topic-all";

vi.mock("../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });
const topic: Topic = { key: "agent:oak:trip", contactId: "trunk:oak", title: "Plan the Lisbon trip", status: "active", unread: true };
const render = async (onPatch = vi.fn(async (_topic: Topic, _change: Record<string, unknown>) => {})) => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onOpen = vi.fn();
  await act(async () => root!.render(<TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Reply" generalUpdatedAt={Date.now()} currentKey="agent:oak:main" items={[{ topic, preview: "Flights found", updatedAt: Date.now() }]} onOpen={onOpen} onAll={() => {}} onPatch={onPatch}/>));
  const click = async (label: string) => { const button = [...host.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === label || x.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); };
  return { host, click, onOpen, onPatch };
};

describe("preview thread row", () => {
  it("uses the preview's short title and switches between General and a real topic key", async () => {
    expect(shortTopicTitle("Plan the Lisbon trip · today")).toBe("Lisbon trip");
    expect(topicEmoji("Lisbon trip", "Flight options", new Set())).toBe("✈️");
    const t = await render();
    expect(t.host.textContent).toContain("Lisbon trip");
    await act(async () => t.host.querySelector<HTMLButtonElement>(".tpRowT5 .tpGoT5[aria-current='false']")!.click());
    expect(t.onOpen).toHaveBeenCalledWith(topic.key);
    await t.click("General");
    expect(t.onOpen).toHaveBeenCalledWith("agent:oak:main");
  });

  it("renames and closes through the supplied session mutation, then persists the layout choice", async () => {
    const t = await render();
    await t.click("More for Lisbon trip");
    await t.click("Rename…");
    const input = t.host.querySelector<HTMLInputElement>("[aria-label='Rename thread'] input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Portugal"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await t.click("Rename");
    expect(t.onPatch).toHaveBeenCalledWith(topic, { label: "Portugal" });
    await t.click("More for Portugal");
    await t.click("Close");
    expect(t.onPatch).toHaveBeenCalledWith(topic, { archived: true });
    await t.click("How threads show: Column");
    await t.click("Tabs above the chat");
    expect(JSON.parse(localStorage.getItem("branch-topics-t5")!)).toEqual({ layout: "tabs", width: 0 });
  });

  it("mutes unread badges as the preview does and remembers the choice", async () => {
    const t = await render();
    expect(t.host.querySelector(".tpBadgeT5")).toBeTruthy();
    await t.click("More for Lisbon trip");
    await t.click("Mute");
    expect(t.host.querySelector(".tpMuteT5")).toBeTruthy();
    expect(t.host.querySelector(".tpBadgeT5")).toBeNull();
    expect(JSON.parse(localStorage.getItem("branch-topic-mute-t5")!)[topic.key]).toBe(true);
    await t.click("More for Lisbon trip");
    await t.click("Unmute");
    expect(t.host.querySelector(".tpBadgeT5")).toBeTruthy();
  });

  it("persists rename and close on the actual engine session with its transcript guard", async () => {
    const request = vi.fn(async () => ({}));
    await patchTopicSession(request, topic, "transcript-1", { label: "Portugal" });
    await patchTopicSession(request, topic, "transcript-1", { archived: true });
    expect(request.mock.calls).toEqual([
      ["sessions.patch", { key: topic.key, agentId: "oak", expectedSessionId: "transcript-1", label: "Portugal" }],
      ["sessions.patch", { key: topic.key, agentId: "oak", expectedSessionId: "transcript-1", archived: true }],
    ]);
  });

  it("merges All by recorded time and labels the thread when its source changes", () => {
    const blocks = mergeTopicTranscripts([
      { key: "agent:oak:main", title: "General", preview: "", updatedAt: 1, blocks: [{ kind: "user", key: "a", text: "First", meta: { timestamp: 100 } }, { kind: "text", key: "c", text: "Third", streaming: false, meta: { timestamp: 300 } }] },
      { key: topic.key, title: topic.title, preview: "", updatedAt: 2, blocks: [{ kind: "text", key: "b", text: "Second", streaming: false, meta: { timestamp: 200 } }] },
    ]);
    expect(blocks.map((block) => block.kind === "notice" ? block.text : block.key)).toEqual(["💬 General", "agent:oak:main:a", "✈️ Lisbon trip", "agent:oak:trip:b", "💬 General", "agent:oak:main:c"]);
  });
});
