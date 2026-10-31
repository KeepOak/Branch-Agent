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

function rows(openRow?: Conversation, conversations?: Conversation[]) {
  const oak = openRow ?? conversation();
  return paletteRows({
    conversations: conversations ?? [oak], trunks: [{ id: "oak", name: "Oak", isDefault: true }],
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

describe("LP-14 destinations and results", () => {
  it("finds Skills, capabilities and Settings and opens the requested destination", () => {
    const navigate = vi.fn();
    window.addEventListener("branch:navigate-place", navigate);
    try {
      for (const [query, tab] of [["skills", "Skills"]]) {
        const hit = filterPalette(rows(), query).find(r => r.label === tab);
        expect(hit).toBeDefined();
        hit!.run();
        expect(navigate.mock.calls.at(-1)?.[0].detail).toEqual({ place: "customize", tab });
      }
      expect(filterPalette(rows(), "capabilities").some(r => r.label === "Get capabilities")).toBe(false);
      expect(filterPalette(rows(), "settings").some(r => r.label === "General")).toBe(true);
      expect(filterPalette(rows(), "appearance").some(r => r.group === "Settings")).toBe(true);
    } finally { window.removeEventListener("branch:navigate-place", navigate); }
  });

  it("deduplicates a group listed as both a contact and session", () => {
    const builders = conversation({ key: "group:builders", title: "Builders", isMain: false });
    const list = rows(undefined, [builders, builders]);
    expect(list.filter(r => r.id === "c:group:builders")).toHaveLength(1);
    expect(filterPalette(list, "skills").some(r => r.label === "Builders")).toBe(false);
  });

  it("clears previous message hits while a new query is pending or fails", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: noop });
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce({ results: [{ sessionKey: "group:builders", snippet: "Old group result" }] })
      .mockRejectedValueOnce(new Error("offline"));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Palette rows={rows()} request={request} rowName={() => "Builders"} onOpenMessage={noop} onClose={noop} />));
    const input = host.querySelector("input")!;
    const type = (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("builders");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(host.textContent).toContain("Old group result");
    await type("skills");
    expect(host.textContent).not.toContain("Old group result");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(host.textContent).not.toContain("Old group result");
    expect(host.textContent).toContain("Message search isn't available");
  });
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
