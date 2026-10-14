// @vitest-environment jsdom
// R1's rail (owner items 5 and 47): Tabs above the chat is the only layout offered, the round + opens New topic, and a topic tab's
// right-click menu has the preview's rows. Classic's rail is covered by TopicRail.test.tsx and stays unchanged.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopicRail, type R1RailHost } from "./TopicRail";

vi.mock("../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });

const topic: Topic = { key: "agent:oak:trip", contactId: "trunk:oak", title: "Plan the Lisbon trip", labelled: true, status: "active", unread: false };

function render(host: Partial<R1RailHost> = {}) {
  const r1: R1RailHost = { layout: "tabs", onLayout: vi.fn(), onCreate: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), ...host };
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const onOpen = vi.fn();
  act(() => root!.render(<TopicRail clear r1={r1} contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="Reply" generalUpdatedAt={1}
    currentKey="agent:oak:main" items={[{ topic, preview: "Flights", updatedAt: 1 }]} onOpen={onOpen} onAll={() => {}} onPatch={async () => {}} />));
  const byLabel = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLElement>("button, [role='menuitem'], [role='menuitemradio']")]
    .find((node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === label);
  const press = async (label: string, scope?: ParentNode) => { const node = byLabel(label, scope); expect(node, label).toBeTruthy(); await act(async () => node!.click()); };
  return { container, r1, onOpen, byLabel, press };
}

describe("R1 thread rail", () => {
  it("offers only Tabs above the chat in its Threads show as menu", async () => {
    const t = render();
    await t.press("How threads show: Tabs above the chat");
    const items = [...document.querySelectorAll("[role='menu'] [role='menuitemradio']")].map((node) => node.textContent?.replace("✓", "").trim());
    expect(items).toEqual(["Tabs above the chat"]);
  });

  it("puts a round + first in the tabs, which opens New topic, and creates a topic from it", async () => {
    const t = render();
    const plus = t.container.querySelector<HTMLButtonElement>(".tpTabsT5 > .tpAddP17")!;
    expect(plus.getAttribute("aria-label")).toBe("New topic");
    await act(async () => plus.click());
    const name = document.querySelector<HTMLInputElement>("input[placeholder='What is it about?']")!;
    expect(name).toBeTruthy();
    await t.press("Create");
    expect(document.querySelector("[role='alert']")?.textContent).toBe("Give the topic a name.");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(name, "Ski weekend"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    await t.press("Create");
    expect(t.r1.onCreate).toHaveBeenCalledWith({ name: "Ski weekend", icon: "💬", colour: null });
  });

  it("right-click on a topic tab opens the preview's rows in order, and Delete asks first", async () => {
    const t = render();
    const tab = [...t.container.querySelectorAll<HTMLElement>(".tpTabT5")].find((node) => node.getAttribute("aria-label")?.startsWith("Plan"));
    expect(tab).toBeTruthy();
    await act(async () => tab!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 60 })));
    const rows = [...document.querySelectorAll("[role='menu'] .mi")].map((node) => node.textContent?.trim());
    expect(rows).toEqual(["Rename…", "Change icon…", "Pin", "Mute", "Close", "Delete…"]);
    await t.press("Delete…", document);
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Delete “");
    await t.press("Delete");
    expect(t.r1.onDelete).toHaveBeenCalledWith(topic);
  });

  it("gives Main chat no topic menu, so its tab keeps only its click", async () => {
    const t = render();
    const main = [...t.container.querySelectorAll<HTMLElement>(".tpTabT5")].find((node) => node.getAttribute("aria-label") === "General");
    expect(main).toBeTruthy();
    await act(async () => main!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
    expect(document.querySelector("[role='menu']")).toBeNull();
    await act(async () => main!.click());
    expect(t.onOpen).toHaveBeenCalledWith("agent:oak:main");
  });
});
