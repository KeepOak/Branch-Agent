// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { Sidebar, type SidebarProps } from "./Sidebar";

/* README item 48 (owner, final): only the left sidebar is frosted; menus and dialogs are clear glass. The dialogs a
   conversation's ••• menu opens (Rename, Delete conversation…, Remove <Trunk>…) are clear (.g-clear), their title, words and
   controls sit on frosted pills, and the one action that does the thing stays solid (data-solid). They draw over the whole
   window (a portal on the body): inside the sidebar its frosted backdrop would hold the fixed scrim to the sidebar's box. */
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
  id, kind, name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const FULL: Record<string, unknown> = {
  "contacts.list": { contacts: [contact("trunk:sapling", "trunk", "Sapling", { isDefault: true }), contact("trunk:ledger", "trunk", "Ledger"), contact("a2a:cc", "outside", "Claude Code")] },
  "agents.list": { defaultId: "sapling", agents: [{ id: "sapling", identity: { name: "Sapling" } }, { id: "ledger", identity: { name: "Ledger" } }] },
  "rooms.list": { rooms: [] }, "a2a.peers.list": { peers: [] }, "users.self": { profile: { id: "me", displayName: "Taofik" } },
};
const methods = ["contacts.list", "agents.list", "rooms.list", "sessions.patch", "sessions.delete", "agents.delete", "config.get"];
const ledger = { key: "agent:ledger:main", title: "Ledger", agentId: "ledger", pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 10, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 };
async function mount() {
  const request = vi.fn(async (method: string) => FULL[method] ?? {});
  const engine = { request, features: { methods, events: [] }, scopes: ["operator.admin"] };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [ledger] as unknown as SidebarProps["sessions"], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
}
const click = async (node: Element | null | undefined) => { expect(node).toBeTruthy(); await act(async () => { (node as HTMLElement).click(); }); };
const row = (label: string) => [...document.querySelectorAll(".g-menu-row")].find((b) => b.textContent?.startsWith(label));
/** Text that sits straight on a surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    const pill = el.closest(".g-label, .g-frost, button, a[href], select");
    if (!pill || (!pill.matches(".g-label, .g-frost") && !pill.closest(".g-clear"))) bare.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${el.textContent!.trim().slice(0, 48)}`);
  }
  return bare;
}
function expectClearDialog(testid: string, solid: string) {
  const dlg = document.querySelector(`[data-testid="${testid}"]`)!;
  expect(dlg, testid).not.toBeNull();
  expect(dlg.classList, testid).toContain("g-clear");
  expect(host.contains(dlg), `${testid} draws over the whole window, not inside the frosted sidebar`).toBe(false);
  expect(dlg.querySelector(".dlg-h h2")!.classList, testid).toContain("g-label");
  expect(bareText(dlg), testid).toEqual([]);
  const solidButton = [...dlg.querySelectorAll(".dlg-f button")].find((b) => b.textContent === solid)!;
  expect(solidButton.hasAttribute("data-solid"), testid).toBe(true);
  for (const b of dlg.querySelectorAll(".dlg-f button")) if (b !== solidButton) expect(b.hasAttribute("data-solid"), b.textContent!).toBe(false);
}

describe("a conversation's dialogs follow the item 48 glass model", () => {
  it("draws Rename as a clear dialog with its title, field and buttons on pills and Rename solid", async () => {
    await mount();
    await click(host.querySelector('[aria-label="More for Claude Code"]'));
    await click(row("Rename"));
    expectClearDialog("rename", "Rename");
  });

  it("draws Delete conversation… as a clear dialog with its words and the Don't ask again line on pills and Delete solid", async () => {
    await mount();
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    await click(row("Delete conversation"));
    expectClearDialog("confirm-delete", "Delete");
    expect(document.querySelector('[data-testid="confirm-delete"] label.check')!.classList).toContain("g-label");
  });

  it("draws Remove <Trunk>… as a clear dialog with its warning on a pill and Remove solid", async () => {
    await mount();
    await click(host.querySelector('[aria-label="More for Ledger"]'));
    await click(row("Ledger"));
    await click(row("Remove Ledger"));
    expectClearDialog("trunk-remove", "Remove");
  });
});
