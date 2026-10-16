// @vitest-environment jsdom
// Card #1095, walkthrough B-091, B-093, B-094 and B-096: each conversation is a row. "New conversation with <Trunk>" makes a
// real, empty thread under that Trunk (preview newConv), and the Trunk's threads show it at once as "New conversation", with
// the preview's row menu (Rename…, Pin, Close, Delete…). Renaming a thread renames that thread in place, never navigating.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopicRail, type R1RailHost } from "../../shell/TopicRail";
import { createEmptyThread, NEW_THREAD_TITLE } from "./new-thread";

vi.mock("../../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });

describe("New conversation with a Trunk", () => {
  it("creates an empty thread under the Trunk's own conversation, with no message and no title", async () => {
    const request = vi.fn(async () => ({ key: "agent:oak:dashboard:4f1c" }));
    await expect(createEmptyThread(request as never, "oak", "agent:oak:main")).resolves.toBe("agent:oak:dashboard:4f1c");
    expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "oak", parentSessionKey: "agent:oak:main" });
  });

  it("waits while the Trunk is still getting ready, then creates it", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("Agent oak has not completed startup inspection and preparation"))
      .mockResolvedValueOnce({ key: "agent:oak:t2" });
    const wait = vi.fn(async () => undefined);
    const pending = createEmptyThread(request as never, "oak", "agent:oak:main", wait);
    await expect(pending).resolves.toBe("agent:oak:t2");
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("says so in plain words when the engine makes nothing", async () => {
    await expect(createEmptyThread(vi.fn(async () => ({})) as never, "oak", "agent:oak:main")).rejects.toThrow("Branch didn't make the conversation. Try again.");
  });
});

describe("a new conversation's row in the Trunk's threads", () => {
  const fresh: Topic = { key: "agent:oak:dashboard:4f1c", contactId: "trunk:oak", title: "agent:oak:dashboard:4f1c", labelled: false, status: "active", unread: false };
  function render() {
    const r1: R1RailHost = { layout: "tabs", onLayout: vi.fn(), onCreate: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onReset: vi.fn() };
    const onOpen = vi.fn(), onPatch = vi.fn(async () => {});
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    act(() => root!.render(<TopicRail clear r1={r1} contactId="trunk:oak" contactName="Oak" contactKey="agent:oak:main" generalPreview="" generalUpdatedAt={1}
      currentKey={fresh.key} items={[{ topic: fresh, preview: "", updatedAt: 2 }]} onOpen={onOpen} onAll={() => {}} onPatch={onPatch} />));
    return { container, r1, onOpen, onPatch };
  }
  const tab = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".tpTabT5")].find((node) => node.getAttribute("aria-label") === NEW_THREAD_TITLE);

  it("shows the empty thread as New conversation, never its key", () => {
    const t = render();
    expect(tab(t.container)).toBeTruthy();
    expect(t.container.textContent).not.toContain("agent:oak");
  });

  it("opens the preview's thread menu on it: Rename…, Pin, Close and Delete… all work", async () => {
    const t = render();
    await act(async () => tab(t.container)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
    const labels = [...document.querySelectorAll("[role='menu'] [role='menuitem']")].map((node) => node.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Rename…", "Pin", "Close", "Delete…"]));
    expect(document.querySelector("[role='menu'] [aria-disabled='true']")).toBeNull();
  });

  it("renames the thread in place: a Rename thread box, the new title saved as its label, and no navigation", async () => {
    const t = render();
    await act(async () => tab(t.container)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
    const rename = [...document.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitem']")].find((node) => node.textContent?.trim() === "Rename…")!;
    await act(async () => rename.click());
    expect(document.body.textContent).toContain("Rename thread");
    const input = document.querySelector<HTMLInputElement>("#topic-rename-form input")!;
    expect(input.value).toBe(NEW_THREAD_TITLE);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(input, "My shopping list"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => document.querySelector<HTMLFormElement>("#topic-rename-form")!.requestSubmit());
    expect(t.onPatch).toHaveBeenCalledWith(fresh, { label: "My shopping list" });
    expect(t.onOpen).not.toHaveBeenCalled();
  });
});
