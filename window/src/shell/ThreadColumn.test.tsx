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
  it("explains the current layout while keeping the other layout actionable", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<ThreadColumn name="Oak" generalKey="agent:oak:main" openKey="agent:oak:main" items={[]} onOpen={() => {}} />));
    const open = async () => act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    await open();
    const column = host.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')!;
    expect(column.disabled).toBe(true);
    expect(column.title).toBe("Threads already show as a column.");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="false"]')!.click());
    expect(host.querySelector(".v23-threads-hidden")).toBeTruthy();
    await open();
    const hidden = host.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')!;
    expect(hidden.disabled).toBe(true);
    expect(hidden.title).toBe("Threads are already hidden.");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="false"]')!.click());
    expect(host.querySelector(".v23-threads-hidden")).toBeNull();
  });
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
});
