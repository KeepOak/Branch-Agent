// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "@branch/gateway-protocol";
import { shouldShowThreadColumn, ThreadColumn } from "./ThreadColumn";
import { TopicRail } from "./TopicRail";

vi.mock("../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const shown = {
  chat: true,
  focus: false,
  stage: false,
  draft: false,
  generalKey: "agent:oak:main",
  topicRow: false,
};
const topic: Topic = { key: "agent:oak:trip", contactId: "trunk:oak", title: "Lisbon trip", status: "active", unread: false };

describe("v23 thread column versus the preview topic row", () => {
  it("keeps main's column when a contact has no topic row, and yields once the preview row is mounted", () => {
    expect(shouldShowThreadColumn(shown)).toBe(true);
    expect(shouldShowThreadColumn({ ...shown, topicRow: true })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, generalKey: null })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, chat: false })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, focus: true })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, stage: true })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, draft: true })).toBe(false);
  });

  it("renders one Threads nav when the preview topic row is mounted, not two", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const topicRow = true;
    const column = shouldShowThreadColumn({ ...shown, topicRow });
    await act(async () => root!.render(<>
      {column ? <ThreadColumn name="Oak" generalKey="agent:oak:main" openKey={topic.key} items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={() => {}} /> : null}
      {topicRow ? <TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Hello" generalWho="You" generalUpdatedAt={1} currentKey={topic.key} items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}} /> : null}
    </>));
    expect([...host.querySelectorAll("nav")].map((nav) => nav.getAttribute("aria-label"))).toEqual(["Threads"]);
  });

  it("dismisses the layout menu with Escape or an outside pointer and returns keyboard focus", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<ThreadColumn name="Oak" generalKey="agent:oak:main" openKey={null} items={[]} onOpen={() => {}} />));
    const trigger = host.querySelector<HTMLButtonElement>(".v23-layout-button")!;
    trigger.focus();
    await act(async () => trigger.click());
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(host.querySelector('[role="menu"]')?.contains(document.activeElement)).toBe(true);
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps Hidden reversible through the layout menu", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<ThreadColumn name="Oak" generalKey="agent:oak:main" openKey={null} items={[]} onOpen={() => {}} />));
    const trigger = host.querySelector<HTMLButtonElement>(".v23-layout-button")!;
    const choose = async (label: string) => {
      trigger.focus();
      await act(async () => trigger.click());
      const choice = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) => button.textContent?.includes(label))!;
      await act(async () => choice.click());
      expect(host.querySelector('[role="menu"]')).toBeNull();
    };
    await choose("Hidden");
    expect(trigger.getAttribute("aria-label")).toBe("How threads show: Hidden");
    expect(host.querySelector(".v23-thread-row")).toBeNull();
    await choose("Column");
    expect(trigger.getAttribute("aria-label")).toBe("How threads show: Column");
    expect(host.querySelector(".v23-thread-row")).not.toBeNull();
  });

  it("counts the General conversation with the threads it lists", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<ThreadColumn name="nas-builder-3" generalKey="agent:oak:main" openKey={null} items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={() => {}} />));
    expect(host.querySelector(".v23-threads-head small")?.textContent).toBe("2 conversations");
  });

  it("opens a thread's menu on right-click, with the thread's key", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const onMenu = vi.fn();
    await act(async () => root!.render(<ThreadColumn name="Oak" generalKey="agent:oak:main" openKey={null} items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={() => {}} onMenu={onMenu} />));
    const row = [...host.querySelectorAll<HTMLButtonElement>(".v23-thread-row")].find((b) => b.textContent?.includes("Lisbon trip"));
    await act(async () => row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 8 })));
    expect(onMenu).toHaveBeenCalledWith(expect.anything(), topic.key, "Lisbon trip");
  });
});
