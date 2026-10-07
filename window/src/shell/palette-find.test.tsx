// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { Palette } from "./Palette";
import { filterPalette } from "./palette-model";
import { paletteRows } from "./palette-rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
const conversation = (extra: Partial<Conversation> = {}): Conversation => ({
  key: "agent:oak:main", title: "Oak", agentId: "oak", isMain: true, pinned: false, archived: false,
  unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 1, preview: "", working: false,
  kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...extra,
});

function rows(openRow?: Conversation) {
  const oak = openRow ?? conversation();
  return paletteRows({
    conversations: [oak], trunks: [{ id: "oak", name: "Oak", isDefault: true }],
    trunkName: () => "Oak", openRow: oak, newConversation: noop, toggleTheme: noop, focusMode: noop,
    shortcuts: noop, setup: noop, tour: noop, quickAsk: noop, openConversation: noop, openPlace: noop,
    openSettings: noop, newTrunk: noop,
  });
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("Find anything search states and Rename", () => {
  it("shows Searching… and not Nothing matches while a message search is pending; after nothing matches, only Nothing matches shows", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(
      <Palette rows={[]} request={request as never} rowName={() => "Oak"} onOpenMessage={noop} onClose={noop} />,
    ));
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "princ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".pal-note")?.textContent).toBe("Searching…");
    expect(host.querySelector(".pal-none")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(host.querySelector(".pal-note")?.textContent).toBe("Searching…");
    expect(host.querySelector(".pal-none")).toBeNull();
    await act(async () => { finish({ results: [] }); });
    expect(host.querySelector(".pal-note")).toBeNull();
    expect(host.querySelector(".pal-none")?.textContent).toBe("Nothing matches. Try a Trunk’s name or a setting.");
  });

  it("includes Rename for an open Trunk and matches rename", () => {
    const list = rows(conversation());
    expect(list.map((row) => row.label)).toEqual(expect.arrayContaining(["Rename Oak…", "Edit Oak…"]));
    expect(filterPalette(list, "rename").map((row) => row.label)).toContain("Rename Oak…");
  });
});
