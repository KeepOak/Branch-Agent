// @vitest-environment jsdom
// Faces as status (R1 sidebar): a working Trunk's face turns in the working ring, unread is one small dot, and the row
// carries no spinner and no status words. Reduced motion stops the ring's turn and keeps its arc. Classic is untouched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact as EngineContact } from "@branch/gateway-protocol";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { ConversationRow } from "../../shell/ConversationRow";
import { contactRow, projectContact } from "../../shell/contacts-model";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label, state }: { label?: string; state?: string }) => <span data-face={label} data-face-state={state} /> }));
vi.mock("../../face/Pebble", () => ({ Pebble: () => null }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const media = (reduce: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
beforeEach(() => {
  localStorage.clear();
  media(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const contact = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: `trunk:${id}`, kind: "trunk", name, threadKey: `agent:${id}:main`, isDefault: false, lastActivityAt: 10,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const ENGINE = {
  "contacts.list": { contacts: [
    contact("scout", "Scout", { working: true }),
    contact("ledger", "Ledger", { threadUnread: true }),
    contact("quill", "Quill"),
  ] },
  "agents.list": { defaultId: "scout", agents: [{ id: "scout" }, { id: "ledger" }, { id: "quill" }] },
  "rooms.list": { rooms: [] },
  "a2a.peers.list": { peers: [] },
  "users.self": { profile: { id: "me", displayName: "Taofik" } },
  "users.list": { profiles: [{ id: "me", displayName: "Taofik" }] },
};
const methods = ["contacts.list", "agents.list", "rooms.list", "sessions.patch", "contacts.markRead"];

async function renderSidebar() {
  const request = vi.fn(async (method: string) => (ENGINE as Record<string, unknown>)[method] ?? {});
  const engine = { request, features: { methods, events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
  return props;
}
const row = (name: string) => host.querySelector<HTMLButtonElement>(`.r1sb-row[aria-label^="${name}"]`)!;
// Anything that reads as a spinner or a text/count badge.
const NOISE = '[class*="spin"], [class*="badge"], [class*="bdg"], [class*="cnt"], [class*="count"], [role="progressbar"], [role="status"]';
const STATUS_WORDS = /working|thinking|running|busy|waiting/i;

describe("R1 sidebar: faces as status", () => {
  it("draws a working Trunk's face in the turning working ring, with no spinner and no status words", async () => {
    await renderSidebar();
    const scout = row("Scout");
    expect(scout).not.toBeNull();
    const ring = scout.querySelector(".r1sb-face > .r1sb-ring.working-ring");
    expect(ring).not.toBeNull();
    expect(ring!.hasAttribute("data-still")).toBe(false);
    expect(ring!.querySelector('[data-face="Scout"]')?.getAttribute("data-face-state")).toBe("work");
    expect(scout.querySelector(NOISE)).toBeNull();
    expect(scout.textContent).not.toMatch(STATUS_WORDS);
    expect(scout.textContent).toContain("Scout says hi");
    // The accessible name still says it works.
    expect(scout.getAttribute("aria-label")).toMatch(/working/);
  });

  it("leaves a resting Trunk's face plain", async () => {
    await renderSidebar();
    expect(row("Quill").querySelector(".working-ring")).toBeNull();
    expect(row("Quill").getAttribute("aria-label")).not.toMatch(/working|unread/);
  });

  it("marks an unread row with the one small dot, no count, and says unread", async () => {
    await renderSidebar();
    const ledger = row("Ledger");
    const dots = ledger.querySelectorAll(".r1sb-unread");
    expect(dots).toHaveLength(1);
    expect(dots[0].textContent).toBe("");
    expect(ledger.querySelector(NOISE)).toBeNull();
    expect(ledger.querySelector(".working-ring")).toBeNull();
    expect(ledger.getAttribute("aria-label")).toMatch(/unread/);
    expect(row("Quill").querySelector(".r1sb-unread")).toBeNull();
  });

  it("stops the ring turning under reduced motion and keeps its still arc", async () => {
    media(true);
    await renderSidebar();
    const ring = row("Scout").querySelector(".r1sb-ring.working-ring");
    expect(ring).not.toBeNull();
    expect(ring!.hasAttribute("data-still")).toBe(true);
    const css = readFileSync(join(process.cwd(), "src/screens/sidebar/sidebar.css"), "utf8");
    expect(css).toMatch(/\.r1sb-ring\[data-still\]::before\s*\{\s*animation:\s*none/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\.r1sb-ring::before\s*\{\s*animation:\s*none/);
    // The arc itself is never hidden: no rule takes the ring's ::before away.
    expect(css).not.toMatch(/\.r1sb-ring[^{]*::before\s*\{[^}]*(display:\s*none|content:\s*none)/);
  });

  it("keeps the unread dot in the collapsed rail", async () => {
    const css = readFileSync(join(process.cwd(), "src/screens/sidebar/sidebar.css"), "utf8");
    expect(css).toMatch(/data-wide="false"\] \.r1sb-row > \.r1sb-meta:has\(> \.r1sb-unread\)\s*\{[^}]*display:\s*block/);
  });
});

describe("Classic sidebar row (unchanged)", () => {
  it("keeps its own working ring and has no R1 face ring", async () => {
    const engineContact = contact("oak", "Oak", { working: true }) as unknown as EngineContact;
    const [classic] = projectContact([engineContact] as never, []).map(contactRow);
    await act(async () => root.render(<ConversationRow row={classic} current={false} time="" showPreview={false} state={{ waiting: false, working: true }}
      trunkName="Oak" onOpen={() => undefined} onMenu={() => undefined} />));
    expect(host.querySelector(".row-av.working-ring[data-working=true]")).not.toBeNull();
    expect(host.querySelector(".r1sb-ring")).toBeNull();
  });
});
