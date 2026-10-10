// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { validateSessionsPatchParams } from "@branch/gateway-protocol";
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
  const updateTopic = async (item: Topic) => act(async () => root!.render(<TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Reply" generalUpdatedAt={Date.now()} currentKey="agent:oak:main" items={[{ topic: item, preview: "Flights found", updatedAt: Date.now() }]} onOpen={onOpen} onAll={() => {}} onPatch={onPatch}/>));
  await updateTopic(topic);
  const click = async (label: string) => { const button = [...host.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === label || x.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); };
  return { host, click, onOpen, onPatch, updateTopic };
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
    await t.updateTopic({ ...topic, title: "Portugal", labelled: true });
    await t.click("More for Portugal");
    await t.click("Close");
    expect(t.onPatch).toHaveBeenCalledWith({ ...topic, title: "Portugal", labelled: true }, { archived: true });
    await t.click("How threads show: Column");
    await t.click("Tabs above the chat");
    expect(JSON.parse(localStorage.getItem("branch-topics-t5")!)).toEqual({ layout: "tabs", width: 0, per: {} });
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

  it("keeps General's who on General's last speaker when a child thread is open", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Booked the hall" generalWho="You" generalUpdatedAt={Date.now()} currentKey={topic.key} items={[{ topic, preview: "Oak: Flights found", who: "Oak", updatedAt: Date.now() }]} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}}/>));
    const general = [...host.querySelectorAll(".tpRowT5")].find((row) => row.querySelector("[aria-label=General]"));
    expect(general?.querySelector(".tpWhoT5")?.textContent).toBe("You:");
    expect(general?.textContent).toContain("Booked the hall");
    expect(general?.textContent).not.toContain("Flights found");
  });

  it("uses explicit engine names and syncs local choices from another window", async () => {
    const t = await render();
    await t.updateTopic({ ...topic, title: "Fix the parser for CSV", labelled: true });
    expect(t.host.textContent).toContain("Fix the parser for CSV");
    await act(async () => {
      localStorage.setItem("branch-topic-emoji-t5", JSON.stringify({ [topic.key]: "🧪", other: "📌" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "branch-topic-emoji-t5" }));
    });
    expect(t.host.querySelector(".tpEmoBtnT5")?.textContent).toBe("🧪");
    await t.click("More for Fix the parser for CSV");
    await t.click("Mute");
    expect(JSON.parse(localStorage.getItem("branch-topic-emoji-t5")!)).toEqual({ [topic.key]: "🧪", other: "📌" });
  });

  it("persists rename and close on the actual engine session with its transcript guard", async () => {
    const request = vi.fn(async (_method: string, _params: unknown) => ({}));
    await patchTopicSession(request, topic, "transcript-1", { label: "Portugal" });
    await patchTopicSession(request, topic, "transcript-1", { archived: true });
    expect(request.mock.calls).toEqual([
      ["sessions.patch", { key: topic.key, agentId: "oak", expectedSessionId: "transcript-1", label: "Portugal" }],
      ["sessions.patch", { key: topic.key, agentId: "oak", expectedSessionId: "transcript-1", archived: true }],
    ]);
    expect(request.mock.calls.every(([, params]) => validateSessionsPatchParams(params))).toBe(true);
  });

  it("merges All by recorded time and labels the thread when its source changes", () => {
    const blocks = mergeTopicTranscripts([
      { key: "agent:oak:main", title: "General", preview: "", updatedAt: 1, blocks: [{ kind: "user", key: "a", text: "First", meta: { timestamp: 100 } }, { kind: "text", key: "c", text: "Third", streaming: false, meta: { timestamp: 300 } }] },
      { key: topic.key, title: topic.title, preview: "", updatedAt: 2, blocks: [{ kind: "text", key: "b", text: "Second", streaming: false, meta: { timestamp: 200 } }] },
    ]);
    expect(blocks.map((block) => block.kind === "notice" ? block.text : block.key)).toEqual(["💬 General", "agent:oak:main:a", "✈️ Lisbon trip", "agent:oak:trip:b", "💬 General", "agent:oak:main:c"]);
    const chosen = mergeTopicTranscripts([
      { key: "agent:oak:main", title: "General", preview: "", updatedAt: 1, blocks: [] },
      { key: topic.key, title: "Fix the parser for CSV", labelled: true, preview: "", updatedAt: 2, blocks: [{ kind: "user", key: "b", text: "Second", meta: { timestamp: 200 } }] },
    ], { [topic.key]: "🧪" });
    expect(chosen[0]).toMatchObject({ kind: "notice", topicKey: topic.key, text: "🧪 Fix the parser for CSV" });
  });
});

describe("tab names", () => {
  it("shows a readable a2a name in the tab, with the same text as its tooltip, and never the raw key", async () => {
    localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "tabs", width: 280, per: {} }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const raw: Topic = { key: "agent:juniper:a2a:branch-nas-linux--tester", contactId: "trunk:juniper", title: "agent:juniper:a2a:branch-nas-linux--tester", status: "active", unread: false };
    await act(async () => root!.render(<TopicRail contactId="trunk:juniper" contactName="Juniper" contactKey="agent:juniper:main" generalPreview="" generalUpdatedAt={0} currentKey="agent:juniper:main" items={[{ topic: raw, preview: "", updatedAt: 0 }]} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}} />));
    const tab = [...host.querySelectorAll("button")].find((button) => button.getAttribute("data-tip") === "Talk with Tester on Nas-linux");
    expect(tab?.getAttribute("aria-label")).toBe("Talk with Tester on Nas-linux");
    expect(host.textContent).not.toContain("a2a:");
  });
});

describe("duplicate tab names", () => {
  it("tells two threads with the same readable name apart in the tab strip", async () => {
    localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "tabs", width: 280, per: {} }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const items = ["agent:juniper:a2a:branch-coordinator-a5a54c", "agent:juniper:a2a:branch-coordinator-b1c2d3"].map((key) => ({ topic: { key, contactId: "trunk:juniper", title: key, status: "active", unread: false } as Topic, preview: "", updatedAt: 0 }));
    await act(async () => root!.render(<TopicRail contactId="trunk:juniper" contactName="Juniper" contactKey="agent:juniper:main" generalPreview="" generalUpdatedAt={0} currentKey="agent:juniper:main" items={items} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}} />));
    const labels = [...host.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "").filter((label) => label.startsWith("Talk with Coordinator"));
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^Talk with Coordinator · [0-9a-f]{6}$/);
    expect(new Set(labels).size).toBe(2);
  });

  it("keeps the tag as its own element, so a cut name never hides it", async () => {
    localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "tabs", width: 280, per: {} }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const items = ["agent:juniper:a2a:branch-coordinator-a5a54c", "agent:juniper:a2a:branch-coordinator-b1c2d3"].map((key) => ({ topic: { key, contactId: "trunk:juniper", title: key, status: "active", unread: false } as Topic, preview: "", updatedAt: 0 }));
    await act(async () => root!.render(<TopicRail contactId="trunk:juniper" contactName="Juniper" contactKey="agent:juniper:main" generalPreview="" generalUpdatedAt={0} currentKey="agent:juniper:main" items={items} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}} />));
    const tab = [...host.querySelectorAll("button.tpTabT5")].find((button) => button.getAttribute("aria-label")?.startsWith("Talk with Coordinator"));
    expect(tab?.querySelector(".tpTabNameT5")?.textContent).toBe("Talk with Coordinator");
    expect(tab?.querySelector(".tpTabTagT5")?.textContent).toMatch(/^ · [0-9a-f]{6}$/);
  });
});

describe("All view separators", () => {
  it("gives two threads with the same readable name distinct separator labels", () => {
    const a = "agent:juniper:a2a:branch-coordinator-a5a54c";
    const b = "agent:juniper:a2a:branch-coordinator-b1c2d3";
    const blocks = mergeTopicTranscripts([
      { key: "agent:juniper:main", title: "General", preview: "", updatedAt: 1, blocks: [] },
      { key: a, title: a, preview: "", updatedAt: 2, blocks: [{ kind: "text", key: "x", text: "One", streaming: false, meta: { timestamp: 100 } }] },
      { key: b, title: b, preview: "", updatedAt: 3, blocks: [{ kind: "text", key: "y", text: "Two", streaming: false, meta: { timestamp: 200 } }] },
    ]);
    const separators = blocks.flatMap((block) => (block.kind === "notice" ? [block.text] : []));
    expect(separators).toHaveLength(2);
    expect(separators[0]).toMatch(/^💬 Talk with Coordinator · [0-9a-f]{6}$/);
    expect(new Set(separators).size).toBe(2);
  });
});
