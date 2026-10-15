// @vitest-environment jsdom
// Parity row 4: the Classic Changes view (the full diff) and its pull request box, re-hosted unchanged in the R1 frame and
// reached from the conversation's ••• menu.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { R1Window } from "./R1Window";
import { ChangesTab } from "../../stage/coding/ChangesTab";
import sidePane from "../../stage/SidePane.tsx?raw";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p data-testid="chat">{name}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../settings/pages/plugged", () => ({ R1_PAGES: {} }));
vi.mock("../settings", () => ({ SettingsFrame: () => <div data-testid="r1-settings" /> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useContacts: () => [[], () => undefined, false], useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
vi.mock("../../stage/desktop-client", () => ({ DesktopClient: class { connect = vi.fn(); } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const patch = "diff --git a/q.md b/q.md\n--- a/q.md\n+++ b/q.md\n@@ -1,3 +1,4 @@\n-Oakfield: $40\n+Oakfield: $38.50\n Brightline: $41\n+Staples: $46\n same\n";
const DIFF = { sessionKey: "agent:scout:main", root: "/w", branch: "fix-quotes", baseRef: "main", aheadCount: 2, commits: [{ sha: "d4e5f6a1", subject: "Compare quotes" }],
  files: [{ path: "q.md", status: "modified", additions: 2, deletions: 1, patch }], additions: 2, deletions: 1 };
const OPTIONS = { personal: null, shared: { source: "system-configured", accountId: 7, login: "team-bot" }, pendingPersonal: null, latestShared: null };
const METHODS = ["sessions.diff", "sessions.github.options", "sessions.github.publish", "sessions.github.status", "computer.status", "browser.request", "agent.identity.get", "users.prefs.set"];
function live(methods = METHODS) {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const request = vi.fn(async (method: string) => method === "sessions.diff" ? DIFF : method === "sessions.github.options" ? OPTIONS
    : method === "sessions.github.publish" ? { status: "published", requestId: "r", url: "https://github.com/o/r/pull/9", repository: "o/r", branch: "fix-quotes", headCommit: "abcdef123" }
    : method === "sessions.describe" ? { session: { key: "agent:scout:main" } } : method === "environments.list" ? { environments: [], profiles: [] } : {});
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } };
  return { session: { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine, gatewayUrl: "ws://gateway.invalid" } as unknown as SaplingSession, request };
}
const header = (label: string) => host.querySelector<HTMLButtonElement>(`.r1-header-right [aria-label="${label}"]`);
const changesRow = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent?.includes("Changes and pull request"));
async function openChanges() {
  await act(async () => header("More")!.click());
  await flush();
  const row = changesRow();
  expect(row).toBeTruthy();
  await act(async () => row!.click());
  await flush();
}

it("opens the re-hosted Changes view from the ••• menu, in place of the conversation and above the composer", async () => {
  const { session, request } = live();
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector(".r1-changes")).toBeNull();
  await openChanges();
  const view = host.querySelector(".r1-changes");
  expect(view?.classList.contains("g-clear")).toBe(true);
  expect(view?.querySelector(".changes-cd")).not.toBeNull();
  expect(request).toHaveBeenCalledWith("sessions.diff", expect.objectContaining({ sessionKey: "agent:scout:main", scope: "all" }));
  expect(view?.textContent).toContain("2 commits ahead of main");
  expect(view?.querySelector(".file-cd b")?.textContent).toBe("q.md");
  expect(view?.querySelectorAll(".ln-cd.add")).toHaveLength(2);
  expect(view?.querySelectorAll(".ln-cd.del")).toHaveLength(1);
  expect(host.querySelector('[data-testid="chat"]')).toBeNull();
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("keeps the full diff view's own controls: the split view, collapsing a file and the scope menu", async () => {
  const { session, request } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await openChanges();
  const view = host.querySelector(".r1-changes")!;
  await act(async () => view.querySelector<HTMLButtonElement>('[aria-label="View"]')!.click());
  const split = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent === "Split view");
  expect(split).toBeTruthy();
  await act(async () => split!.click());
  expect(view.querySelector(".hunk-split-cd")).not.toBeNull();
  await act(async () => view.querySelector<HTMLButtonElement>(".tog-cd")!.click());
  expect(view.querySelector(".tog-cd")!.getAttribute("aria-expanded")).toBe("false");
  expect(view.querySelector(".hunk-split-cd")).toBeNull();
  await act(async () => [...view.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.startsWith("All changes"))!.click());
  const uncommitted = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent === "Uncommitted");
  await act(async () => uncommitted!.click());
  await flush();
  expect(request).toHaveBeenCalledWith("sessions.diff", expect.objectContaining({ scope: "uncommitted" }));
});

it("opens a pull request from the re-hosted pull request box as the shared account", async () => {
  const { session, request } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await openChanges();
  const box = host.querySelector(".r1-changes section.pr-box-cd");
  expect(box?.getAttribute("aria-label")).toBe("Open a pull request");
  const open = [...box!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Open a pull request as team-bot")!;
  expect(open.disabled).toBe(false);
  await act(async () => open.click());
  await flush();
  expect(request).toHaveBeenCalledWith("sessions.github.publish", expect.objectContaining({ sessionKey: "agent:scout:main", selection: { source: "shared", expected: OPTIONS.shared } }));
  expect(box!.textContent).toContain("Pull request opened");
  expect(box!.querySelector<HTMLAnchorElement>("a")?.href).toBe("https://github.com/o/r/pull/9");
});

it("closes with its × and with Escape, back to the conversation, and hands focus back to •••", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await openChanges();
  await act(async () => host.querySelector<HTMLButtonElement>('.r1-changes [aria-label="Close changes"]')!.click());
  expect(host.querySelector(".r1-changes")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
  expect(document.activeElement).toBe(header("More"));
  await openChanges();
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(host.querySelector(".r1-changes")).toBeNull();
  expect(host.querySelector('[data-testid="chat"]')).not.toBeNull();
});

it("gives way to the computer stage, and the stage to it", async () => {
  const { session } = live();
  await act(async () => root.render(<R1Window session={session} />));
  await openChanges();
  await act(async () => header("Computer")!.click());
  await flush();
  expect(host.querySelector(".r1-changes")).toBeNull();
  expect(host.querySelector(".r1-stage")).not.toBeNull();
  await openChanges();
  expect(host.querySelector(".r1-stage")).toBeNull();
  expect(host.querySelector(".r1-changes")).not.toBeNull();
  expect(header("Computer")!.getAttribute("aria-pressed")).toBe("false");
});

it("keeps the ••• row Coming when the engine can't read a conversation's changes (R1-10)", async () => {
  const { session, request } = live(METHODS.filter(m => m !== "sessions.diff"));
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => header("More")!.click());
  await flush();
  const row = changesRow()!;
  expect(row.getAttribute("aria-disabled")).toBe("true");
  expect(row.getAttribute("data-coming")).toBe("This engine can’t show this conversation’s changes.");
  await act(async () => row.click());
  await flush();
  expect(host.querySelector(".r1-changes")).toBeNull();
  expect(request.mock.calls.map(call => call[0])).not.toContain("sessions.diff");
});

it("re-hosts the same Classic component Classic's side panel still draws, under clear glass", async () => {
  expect(sidePane).toContain('import { ChangesTab } from "./coding/ChangesTab"');
  expect(sidePane).toContain("<ChangesTab engine={engine} />");
  const { session } = live();
  await act(async () => root.render(<ChangesTab engine={session.engine} />));
  await flush();
  const classic = [...host.querySelectorAll("[class]")].map(el => el.className);
  await act(async () => root.render(<R1Window session={session} />));
  await openChanges();
  expect([...host.querySelectorAll(".r1-changes > .changes-cd [class], .r1-changes > .changes-cd")].map(el => el.className)).toEqual(classic);
  const changesCss = readFileSync(resolve(__dirname, "../changes/r1-changes.css"), "utf8");
  // README item 48: the Classic cards lose their fill and outline; text and rows sit on frosted pills.
  expect(changesCss).toContain(".r1-changes .file-cd, .r1-changes .pr-box-cd { background: transparent; border-color: transparent; }");
  expect(changesCss).toContain("var(--gp-fill)");
});
