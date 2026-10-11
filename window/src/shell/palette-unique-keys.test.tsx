// @vitest-environment jsdom
// Find anything from What's new logged "Encountered two children with the same key" (board #419).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { Palette } from "./Palette";
import { paletteRows } from "./palette-rows";
import { WhatsNew, type NewRow } from "./WhatsNew";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
const conversation = (extra: Partial<Conversation> = {}): Conversation => ({
  key: "agent:oak:main", title: "Oak", agentId: "oak", isMain: true, pinned: false, archived: false,
  unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 1, preview: "", working: false,
  kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...extra,
});

// The shell lists contacts and session rows together, so one room key can arrive twice under the same title.
const room = conversation({ key: "agent:oak:room:garden", title: "Garden", isMain: false, groupChat: true });
function rows() {
  return paletteRows({
    conversations: [conversation(), room, { ...room }, conversation({ key: "agent:oak:t1", title: "Garden", isMain: false })],
    trunks: [{ id: "oak", name: "Oak", isDefault: true }, { id: "oak", name: "Oak tree", isDefault: false }],
    trunkName: (id) => (id === "oak" ? "Oak (default)" : "Trunk"),
    openRow: conversation(), newConversation: noop, toggleTheme: noop, focusMode: noop, shortcuts: noop, setup: noop,
    tour: noop, quickAsk: noop, openConversation: noop, openPlace: noop, openSettings: noop, newTrunk: noop,
  });
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function keyWarnings(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.includes("same key"));
}

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

async function type(host: HTMLElement, text: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Find anything keys", () => {
  it("gives every row a unique id when a conversation or Trunk is listed twice", () => {
    const ids = rows().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows().filter((row) => row.id === `c:${room.key}`)).toHaveLength(1);
  });

  it("opens and filters with duplicate-looking titles and logs no duplicate-key warning", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi.fn(() => new Promise(() => {}));
    const host = await render(<Palette rows={rows()} request={request as never} rowName={() => "Oak"} onOpenMessage={noop} onClose={noop} />);
    expect(host.querySelectorAll("[data-testid=palette-row]").length).toBeGreaterThan(0);
    await type(host, "oak");
    await type(host, "garden");
    expect([...host.querySelectorAll(".pal-label")].filter((el) => el.textContent === "Garden")).toHaveLength(2);
    expect(keyWarnings(spy)).toEqual([]);
  });
});

describe("What's new keys", () => {
  it("lists update notes that repeat a line without a duplicate-key warning", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const row: NewRow = { icon: "check", title: "Find anything", line: "Ctrl K.", run: noop };
    const host = await render(
      <WhatsNew version="1.0.0" update={null} installed={{ New: [row, { ...row }], Better: [], Fixed: [] }}
        onOpenUpdates={noop} onInstall={noop} onClose={noop} />,
    );
    expect(host.ownerDocument.querySelectorAll(".new-row13")).toHaveLength(2);
    expect(keyWarnings(spy)).toEqual([]);
  });
});
