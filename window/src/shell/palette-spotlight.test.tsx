// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { Palette } from "./Palette";
import { paletteRows } from "./palette-rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
const conversation = (extra: Partial<Conversation> = {}): Conversation => ({
  key: "agent:oak:main", title: "Oak", agentId: "oak", isMain: true, pinned: false, archived: false,
  unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 1, preview: "", working: false,
  kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...extra,
});

function rows() {
  const oak = conversation();
  return paletteRows({
    conversations: [oak],
    trunks: [
      { id: "oak", name: "Oak", isDefault: true, theme: "Keeps the family calendar" },
      { id: "elm", name: "Elm", isDefault: false, theme: "Reads the research\nand writes it up" },
    ],
    trunkName: (id) => (id === "elm" ? "Elm" : "Oak"),
    openRow: oak,
    newConversation: noop, toggleTheme: noop, focusMode: noop, shortcuts: noop, setup: noop, tour: noop,
    quickAsk: noop, openConversation: noop, openPlace: noop, openSettings: noop, newTrunk: noop,
  });
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

async function show(request: (method: string, params?: unknown) => Promise<unknown> = async () => ({})) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: noop });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Palette rows={rows()} request={request as never} rowName={(key) => (key.includes("elm") ? "Elm" : "Oak")} onOpenMessage={noop} onClose={noop} />));
  return host;
}

const labels = (host: HTMLElement) => [...host.querySelectorAll(".pal-label")].map((node) => node.textContent);

describe("Find anything, empty and while typing", () => {
  it("lists Trunks, each with a one-line description, and still lists commands", async () => {
    const host = await show();
    expect(labels(host).slice(0, 2)).toEqual(["Oak", "Elm"]);
    expect([...host.querySelectorAll(".pal-detail")].map((node) => node.textContent)).toEqual([
      "Keeps the family calendar",
      "Reads the research and writes it up",
    ]);
    expect(labels(host)).toContain("New conversation");
    expect(host.querySelector(".pal-none")).toBeNull();
  });

  it("shows a message hit with the matched words in bold and a meta line", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    const at = Date.parse("2026-10-09T12:00:00Z");
    const request = vi.fn(async () => ({
      results: [{ sessionKey: "agent:oak:main", role: "user", snippet: "Send the Hartwell invoice today", timestamp: at, messageId: "m1" }],
    }));
    const host = await show(request);
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "invoice");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const hit = [...host.querySelectorAll(".pal-label")].find((node) => node.textContent?.includes("Hartwell"));
    expect(hit?.querySelector("strong")?.textContent).toBe("invoice");
    expect(host.querySelector(".pal-meta")?.textContent).toBe("You to Oak · 6d ago");
    expect(request).toHaveBeenCalledWith("sessions.search", expect.objectContaining({ query: "invoice", limit: 25 }));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(labels(host)).toContain("New conversation");
  });
});
