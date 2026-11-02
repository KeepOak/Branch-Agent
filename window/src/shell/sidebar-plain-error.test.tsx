// @vitest-environment jsdom
// Sidebar surfaces: a raw engine error reads as one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Topic } from "@branch/gateway-protocol";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { ReadOnlyThread, type CatalogThread } from "./AppSections";
import { BranchLinkDialog } from "./BranchLinkDialog";
import { IconColourPicker } from "./row-look";
import { TopicRail } from "./TopicRail";

vi.mock("../face/Face", () => ({ Face: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

const topic: Topic = { key: "agent:oak:trip", contactId: "trunk:oak", title: "Plan the Lisbon trip", status: "active", unread: false };
const thread: CatalogThread = { catalogId: "codex", hostId: "local", threadId: "t1", name: "Notes", at: 1, canArchive: false, canContinue: false };
const row: Conversation = {
  key: "agent:oak:main", title: "Oak", agentId: "oak", isMain: true, pinned: false,
  archived: false, unread: false, snoozedUntil: null, createdAt: 0, updatedAt: 0,
  preview: "", working: false, kind: "trunk", system: false, automation: false,
  totalTokens: 0, contextTokens: 0, sessionId: "s1",
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === label || x.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};
const alertText = () => host.querySelector("[role='alert']")?.textContent ?? "";

describe("the sidebar never shows a raw engine error at Regular", () => {
  it("names a failed topic rename in a plain sentence", async () => {
    const onPatch = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Reply" generalUpdatedAt={1}
        currentKey="agent:oak:main" items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={() => {}} onAll={() => {}} onPatch={onPatch} />,
    ));
    await click("More for Lisbon trip");
    await click("Rename…");
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Portugal");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Rename");
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed catalog read in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <ReadOnlyThread request={request} thread={thread} label="Codex" onClose={() => {}} onBringIn={() => {}} />,
    ));
    await settle();
    expect(host.textContent).toContain("Couldn't read it.");
    expect(host.textContent).toContain(REACH);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("names a failed Branch link in a plain sentence and keeps the loopback sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "device.pair.setupCode") throw new Error(ENGINE);
      return { links: [] };
    });
    await act(async () => root.render(
      <BranchLinkDialog engine={{ request } as unknown as WindowEngine} onClose={() => undefined} />,
    ));
    await click("Make a code");
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);

    const loopback = vi.fn(async (method: string) => {
      if (method === "device.pair.setupCode") throw new Error("Gateway is only bound to loopback. Set gateway.publicOrigin...");
      return { links: [] };
    });
    await act(async () => root.render(
      <BranchLinkDialog engine={{ request: loopback } as unknown as WindowEngine} onClose={() => undefined} />,
    ));
    await click("Make a code");
    await settle();
    expect(host.textContent).toContain("This computer can’t be reached by another computer yet");
    expect(host.textContent).not.toContain("gateway.publicOrigin");
    expect(host.textContent).not.toMatch(/PAIRING_GATEWAY_LOOPBACK_ERROR|ECONNREFUSED/);
  });

  it("names a failed icon change in a plain sentence", async () => {
    const onSet = vi.fn(async () => ENGINE);
    await act(async () => root.render(<IconColourPicker row={row} onSet={onSet} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".swc")!.click());
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const onPatch = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <TopicRail contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Reply" generalUpdatedAt={1}
        currentKey="agent:oak:main" items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={() => {}} onAll={() => {}} onPatch={onPatch} />,
    ));
    await click("More for Lisbon trip");
    await click("Rename…");
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Portugal");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Rename");
    await settle();
    expect(alertText()).toBe(ENGINE);

    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <ReadOnlyThread request={request} thread={thread} label="Codex" onClose={() => {}} onBringIn={() => {}} />,
    ));
    await settle();
    expect(host.textContent).toContain(`Couldn't read it: ${ENGINE}`);
  });
});
