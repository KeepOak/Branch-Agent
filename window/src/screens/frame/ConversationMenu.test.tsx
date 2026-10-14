// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { roomRulesItems } from "../../rooms/room-rules";
import type { ShellRoom } from "../../rooms/useShellRoom";
import type { Block } from "../../thread/model";
import { ConversationMenu } from "./ConversationMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = Date.now();
const row: Conversation = {
  key: "agent:ledger:topic-1", title: "Month-end", agentId: "ledger", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: NOW, updatedAt: NOW, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0,
};
const history = [{ kind: "user", text: "Close the books" }, { kind: "text", text: "Books closed." }] as unknown as Block[];
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function setup(room?: ShellRoom["menu"]) {
  const request = vi.fn(async (method: string) => (method === "sessions.branches.list" ? { branches: [] } : {}));
  const reload = vi.fn(async () => undefined);
  const engine = { request, onEvent: () => () => undefined, features: { methods: ["sessions.patch", "sessions.reset", "sessions.delete", "sessions.branches.list", "chat.history", "rooms.rule.set"], events: [] } };
  const session = { engine, request, reload, getSnapshot: () => ({ sessionKey: row.key }) } as unknown as SaplingSession;
  const list = { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [row] }) } as unknown as ConversationList;
  const onOpen = vi.fn();
  function Host() {
    const anchor = useRef<HTMLButtonElement>(null);
    return <><button ref={anchor} type="button">More</button>
      <ConversationMenu session={session} open anchor={anchor} onClose={() => undefined} sessionKey={row.key} row={row} isDefault={false} list={list} name="Ledger" history={history}
        work={{ global: "normal", override: null, setOverride: async () => undefined }} onOpen={onOpen} mainKey="agent:ledger:main" onPlace={() => undefined} room={room} /></>;
  }
  return { request, reload, onOpen, Host };
}
const rowNamed = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".g-menu [data-menu-item]")].find((el) => el.querySelector(".g-menu-label")?.firstChild?.textContent === label)!;
const click = async (el: HTMLElement) => act(async () => { el.click(); await Promise.resolve(); });

it("opens the approved nine rows on clear glass, every row on its own pill", async () => {
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  const menu = document.querySelector(".g-popover > .r1c-conv")!;
  expect(menu.classList).toContain("g-clear");
  expect([...menu.querySelectorAll(".g-menu-label")].map((el) => el.firstChild?.textContent)).toEqual(["Pin to top", "Rename", "Snooze", "Archive", "Send to the board", "Export", "View", "Start over…", "Delete…"]);
});

it("Start over… opens the Classic dialog as clear glass and resets the conversation through sessions.reset", async () => {
  const { Host, request, reload } = setup();
  await act(async () => root.render(<Host />));
  await click(rowNamed("Start over…"));
  const dialog = document.querySelector<HTMLElement>('[data-testid="start-over"]')!;
  expect(dialog.classList).toContain("g-clear");
  await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Start over")!);
  expect(request).toHaveBeenCalledWith("sessions.reset", { key: row.key, agentId: "ledger", reason: "reset" });
  expect(reload).toHaveBeenCalledTimes(1);
});

it("View › Replay plays the conversation back in the Classic replay dialog", async () => {
  const { Host } = setup();
  await act(async () => root.render(<Host />));
  await click(rowNamed("View"));
  await click(rowNamed("Replay this conversation"));
  const dialog = document.querySelector<HTMLElement>('[data-testid="replay"]')!;
  expect(dialog.classList).toContain("g-clear");
  expect(dialog.textContent).toContain("Close the books");
  expect(dialog.textContent).toContain("1 of 2");
});

it("View › Map reads the conversation's paths through sessions.branches.list", async () => {
  const { Host, request } = setup();
  await act(async () => root.render(<Host />));
  await click(rowNamed("View"));
  await click(rowNamed("Map of this conversation"));
  const dialog = document.querySelector<HTMLElement>('[data-testid="conversation-map"]')!;
  expect(dialog.classList).toContain("g-clear");
  expect(request).toHaveBeenCalledWith("sessions.branches.list", { sessionKey: row.key, agentId: "ledger" });
});

it("Pin to top pins through sessions.patch, and Delete… asks, deletes and returns to the default conversation", async () => {
  const { Host, request, onOpen } = setup();
  await act(async () => root.render(<Host />));
  await click(rowNamed("Pin to top"));
  expect(request).toHaveBeenCalledWith("sessions.patch", { key: row.key, agentId: "ledger", pinned: true, snoozedUntil: null });
  await act(async () => root.render(<Host />));
  await click(rowNamed("Delete…"));
  const dialog = document.querySelector<HTMLElement>('[data-testid="confirm-delete"]')!;
  expect(dialog.classList).toContain("g-clear");
  await click(dialog.querySelector<HTMLButtonElement>('[data-testid="confirm-delete-yes"]')!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(request).toHaveBeenCalledWith("sessions.delete", { key: row.key, agentId: "ledger", deleteTranscript: true });
  expect(onOpen).toHaveBeenCalledWith("agent:ledger:main");
});

it("in a group chat, Group rules › Who answers re-hosts the Classic rule rows, and choosing the lead runs the room's choice", async () => {
  const choose = vi.fn();
  const { Host } = setup({ ruleWords: "A lead Trunk decides", rules: () => roomRulesItems({ chatApp: false, branchGroup: true, rule: null, choose }) });
  await act(async () => root.render(<Host />));
  expect(rowNamed("Group rules").textContent).toContain("A lead Trunk decides");
  await click(rowNamed("Group rules"));
  expect([...document.querySelectorAll(".g-menu .g-menu-label")].map((el) => el.firstChild?.textContent)).toEqual(["Group rules", "A lead Trunk decides", "Everyone, every time", "Only those you @mention"]);
  expect(rowNamed("Everyone, every time").getAttribute("aria-disabled")).toBe("true");
  await click(rowNamed("A lead Trunk decides"));
  expect(choose).toHaveBeenCalledWith("lead");
});
