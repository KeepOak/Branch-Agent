// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { ConfirmLockdown } from "../../shell/ConfirmLockdown";
import { Frame } from "./Frame";
import { R1Window } from "./R1Window";

/* README item 48 (owner, final): menus, popovers and dialogs are clear glass with their words on frosted pills. In the R1
   window the header pill's Agent details popover is clear with its name, line and Close on pills, and the Lockdown
   confirmation is a clear dialog with Turn Lockdown on solid. */
const lockdownArgs = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("../chat/ChatView", () => ({ ChatView: () => <p>chat</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: (...args: unknown[]) => { lockdownArgs.value = args; return { on: false, supported: false, toggle: async () => undefined, confirmation: null }; } }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <nav aria-label="Sidebar stub" /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map(), useMachine: () => null, useTrunks: () => ({ list: [], defaultId: null }), useListPeople: () => ({ selfId: null, names: new Map() }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../approvals/ProblemBanners", () => ({ useProblemBannerRows: () => undefined }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
/** Text that sits straight on a surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    if (el.closest(".g-label, .g-frost")) continue;
    const pill = el.closest(".g-label, .g-frost, button, a[href], select");
    if (!pill || (!pill.matches(".g-label, .g-frost") && !pill.closest(".g-clear"))) bare.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${el.textContent!.trim().slice(0, 48)}`);
  }
  return bare;
}

it("opens Agent details as a clear popover with the name, its line and Close on pills", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
  const request = vi.fn(async () => ({ name: "Ledger", emoji: "📒" }));
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request, onEvent: () => () => undefined } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  const pill = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Ledger");
  expect(pill).toBeTruthy();
  await act(async () => pill!.click());
  await act(async () => undefined);
  const box = document.querySelector(".g-popover > .r1-agent-details")!;
  expect(box).not.toBeNull();
  expect(box.classList).toContain("g-clear");
  expect(box.querySelector("strong")!.classList).toContain("g-label");
  expect(bareText(box)).toEqual([]);
  const css = readFileSync("src/screens/frame/frame.css", "utf8").replace(/\s+/g, " ");
  expect(css).toContain(".g-popover:has(> .r1-agent-details) { background: transparent; backdrop-filter: none;");
  expect(css).toMatch(/:root\[data-transparency="reduce"\] \.g-popover:has\(> \.r1-agent-details\) \{ background: var\(--raise\);/);
  expect(css).toMatch(/prefers-reduced-transparency: reduce\) \{ :root:not\(\[data-transparency\]\) \.g-popover:has\(> \.r1-agent-details\) \{ background: var\(--raise\);/);
});

it("asks for the Lockdown confirmation as a clear dialog with its words on a pill and Turn Lockdown on solid", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(lockdownArgs.value[3]).toBe(true);
  await act(async () => root.render(<ConfirmLockdown clear busy={false} onCancel={() => {}} onConfirm={() => {}} />));
  const dlg = document.querySelector('[data-testid="confirm-lockdown"]')!;
  expect(dlg.classList).toContain("g-clear");
  expect(bareText(dlg)).toEqual([]);
  const buttons = [...dlg.querySelectorAll(".dlg-f button")];
  expect(buttons.find((b) => b.textContent === "Turn Lockdown on")!.hasAttribute("data-solid")).toBe(true);
  expect(buttons.find((b) => b.textContent === "Cancel")!.hasAttribute("data-solid")).toBe(false);
});

it("draws the header on the clear conversation as frosted pills, never the earlier control glass", async () => {
  await act(async () => root.render(<Frame sidebar={<span />} main={<p>Chat</p>} header={{ title: "Ledger", onOpen: () => {} }} />));
  const header = host.querySelector(".r1-header")!;
  expect(header.querySelectorAll(".g-ctl")).toHaveLength(0);
  for (const sel of [".r1-drawer-button", ".r1-history", ".r1-header-right .g-capsule", ".g-pill"]) expect(header.querySelector(sel)!.classList, sel).toContain("g-frost");
  expect(header.querySelector(".g-pill-title")!.textContent).toBe("Ledger");
  expect(bareText(header)).toEqual([]);
  // Only the sidebar keeps frosted glass: no earlier --gc/--gf/--gk fill outside its rules, in frame.css or the shared capsule.
  const rules = (file: string) => [...readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const outside = rules("src/screens/frame/frame.css").filter(([, sel]) => !/r1-sid(e|ebar)/.test(sel)).filter(([, , body]) => /var\(--g[cfk]-/.test(body)).map(([, sel]) => sel.trim());
  expect(outside).toEqual([]);
  expect(rules("src/glass/glass.css").filter(([sel, , body]) => /g-capsule|g-pill/.test(sel) && /var\(--g[cfk]-/.test(body ?? "")).map(([s]) => s.trim())).toEqual([]);
});
