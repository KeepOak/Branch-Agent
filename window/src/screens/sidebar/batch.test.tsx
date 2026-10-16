// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import type { MenuItem } from "../../shell/Menu";
import { glassEntries } from "./batch";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => null }));
vi.mock("../../connect/branch-version", async (load) => ({ ...(await load<typeof import("../../connect/branch-version")>()), useBranchVersion: () => "0.4.4" }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const contact = (id: string, kind: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, kind, name, threadKey: kind === "outside" ? `agent:${id.split(":")[1]}:graft` : `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
  thread: { key: kind === "outside" ? `agent:${id.split(":")[1]}:graft` : `agent:${id.split(":")[1]}:main`, title: name, agentId: id.split(":")[1], pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 },
  ...extra,
});
const RESPONSES: Record<string, unknown> = {
  "contacts.list": { contacts: [contact("trunk:ledger", "trunk", "Ledger"), contact("a2a:cc", "outside", "Claude Code"), contact("a2a:cx", "outside", "Codex"), contact("a2a:gm", "outside", "Gemini")] },
  "agents.list": { defaultId: "ledger", agents: [{ id: "ledger", identity: { name: "Ledger" } }] },
  "rooms.list": { rooms: [] }, "a2a.peers.list": { peers: [] }, "users.self": { profile: { id: "me" } }, "users.list": { profiles: [] },
};
const methods = ["contacts.list", "agents.list", "rooms.list", "sessions.patch", "sessions.patchMany", "sessions.delete", "sessions.compact", "contacts.markRead", "contacts.topics", "chat.history"];

const ledgerMain = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", isMain: true, pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 };
function setup() {
  const request = vi.fn(async (method: string) => RESPONSES[method] ?? {});
  const engine = { request, features: { methods, events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [ledgerMain] as unknown as SidebarProps["sessions"], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null }, onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  return { request, props, render: async () => { await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>)); await act(async () => undefined); } };
}
const rowOf = (name: string) => host.querySelector<HTMLElement>(`.r1sb-row[aria-label^="${name}"]`)!;
const press = async (node: HTMLElement, init: MouseEventInit = {}) => act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })); });
const picked = () => [...host.querySelectorAll(".r1sb-rw[data-picked] .r1sb-name > span")].map(node => node.textContent);

describe("R1 sidebar: select several and the batch menu (Classic batch-menu.ts re-hosted)", () => {
  it("picks rows with Alt instead of opening them, and a plain click clears", async () => {
    const { render, props } = setup();
    await render();
    await press(rowOf("Claude Code"), { altKey: true });
    await press(rowOf("Codex"), { altKey: true });
    await press(rowOf("Gemini"), { altKey: true });
    expect(picked()).toEqual(["Claude Code", "Codex", "Gemini"]);
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(rowOf("Codex").getAttribute("aria-label")).toContain("selected");
    await press(rowOf("Ledger"), { altKey: true });
    expect(picked()).toEqual(["Claude Code", "Codex", "Gemini"]);
    await press(rowOf("Codex"));
    expect(picked()).toEqual([]);
    expect(props.onOpen).toHaveBeenCalledWith("agent:cx:graft");
  });

  it("opens the batch menu on a picked row and archives them all through sessions.patchMany", async () => {
    const { render, request } = setup();
    await render();
    await press(rowOf("Claude Code"), { altKey: true });
    await press(rowOf("Codex"), { altKey: true });
    await act(async () => host.querySelector<HTMLElement>('[aria-label="More for Codex"]')!.click());
    const labels = [...document.querySelectorAll(".g-menu-row .g-menu-label")].map(node => node.textContent);
    expect(labels.map(label => label?.split("Moving")[0])).toEqual(["Mark 2 as unread", "Move 2 to project", "Archive 2", "Delete 2…"]);
    await act(async () => [...document.querySelectorAll<HTMLElement>(".g-menu-row")].find(node => node.textContent?.includes("Archive 2"))!.click());
    const call = request.mock.calls.find(([method]) => method === "sessions.patchMany") as unknown as [string, { targets: unknown[]; patch: Record<string, unknown> }];
    expect(call[1].targets).toHaveLength(2);
    expect(call[1].patch).toEqual(expect.objectContaining({ archived: true }));
  });

  it("asks before deleting the picked rows, then deletes each", async () => {
    const { render, request } = setup();
    await render();
    await press(rowOf("Claude Code"), { altKey: true });
    await press(rowOf("Codex"), { altKey: true });
    await act(async () => host.querySelector<HTMLElement>('[aria-label="More for Claude Code"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>(".g-menu-row")].find(node => node.textContent?.includes("Delete 2"))!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("2");
    expect(request).not.toHaveBeenCalledWith("sessions.delete", expect.anything());
  });

  it("offers Keep only the last 400 lines in Tidy up at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const { render } = setup();
    await render();
    await act(async () => host.querySelector<HTMLElement>('[aria-label="More for Ledger"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>(".g-menu-row")].find(node => node.querySelector(".g-menu-label")?.firstChild?.textContent === "Tidy up…")!.click());
    expect([...document.querySelectorAll(".g-menu-label")].map(node => node.textContent)).toContain("Keep only the last 400 lines…");
  });

  it("turns Classic menu items into glass entries that name their calls", () => {
    const run = vi.fn();
    const items: MenuItem[] = [{ kind: "head", label: "2 selected" }, { label: "Archive 2", run, testid: "batch-archive" }, { label: "Move", run, disabled: "Not yet." }, { kind: "sep" }, { label: "Delete 2…", run, danger: true, testid: "batch-delete" }];
    const { label, rows } = glassEntries(items);
    expect(label).toBe("2 selected");
    expect(rows.map(row => [row.label, row.need ?? null, row.off ?? null, Boolean(row.gap)])).toEqual([["Archive 2", "sessions.patchMany", null, false], ["Move", null, "Not yet.", false], ["Delete 2…", "sessions.delete", null, true]]);
  });
});
