// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "@branch/gateway-protocol";
import { TopicRail } from "./TopicRail";

vi.mock("../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const topic: Topic = { key: "agent:oak:trip", contactId: "trunk:oak", title: "Lisbon trip", status: "active", unread: false };

describe("thread navigation after the legacy column removal", () => {
  it("keeps General and additional threads selectable in the replacement topic rail", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const onOpen = vi.fn();
    await act(async () => root!.render(
      <TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Hello" generalWho="You" generalUpdatedAt={1} currentKey={topic.key} items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={onOpen} onAll={() => {}} onPatch={async () => {}} />
    ));
    expect([...host.querySelectorAll("nav")].map((nav) => nav.getAttribute("aria-label"))).toEqual(["Threads"]);
    const general = host.querySelector<HTMLButtonElement>('button[aria-label="General"]')!;
    await act(async () => general.click());
    expect(onOpen).toHaveBeenLastCalledWith("agent:oak:main");
    const child = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Lisbon trip"))!;
    await act(async () => child.click());
    expect(onOpen).toHaveBeenLastCalledWith(topic.key);
  });
});
