// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadColumn } from "./ThreadColumn";
import { TopicRail } from "./TopicRail";
import type { TopicListItem } from "./contact-topics";

vi.mock("../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});
const item = (status: "active" | "archived"): TopicListItem => ({
  topic: { key: `agent:oak:${status}`, contactId: "trunk:oak", title: status === "active" ? "Trip" : "Notes", status, unread: false },
  preview: "", updatedAt: 0,
});

describe.each(["rail", "fallback"] as const)("%s thread header", (kind) => {
  it.each([
    { name: "General alone", items: [], count: "1 thread" },
    { name: "General and an active thread", items: [item("active")], count: "2 threads" },
    { name: "General, active and closed threads", items: [item("active"), item("archived")], count: "3 threads" },
  ])("counts $name", async ({ items, count }) => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(kind === "rail"
      ? <TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="" generalUpdatedAt={0} currentKey="agent:oak:main" items={items} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}} />
      : <ThreadColumn name="Oak" generalKey="agent:oak:main" openKey="agent:oak:main" items={items} onOpen={() => {}} />));
    expect(host.querySelector(kind === "rail" ? ".tpHeadT5 small" : ".v23-threads-head small")?.textContent).toBe(kind === "fallback" ? count.replace("thread", "conversation") : count);
    expect(host.textContent).toContain("General");
    if (kind === "rail" && items.some(({ topic }) => topic.status === "archived")) {
      const closed = host.querySelector<HTMLButtonElement>(".tpClosedHT5")!;
      expect(closed.textContent).toContain("Closed · 1");
      await act(async () => closed.click());
      expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(3);
      expect(host.querySelector(".tpHeadT5 small")?.textContent).toBe(count);
    }
    if (kind === "fallback" && items.length) {
      expect(host.querySelector(".v23-threads-toggle")?.textContent).toContain(`Threads · ${items.length}`);
    }
  });
});
