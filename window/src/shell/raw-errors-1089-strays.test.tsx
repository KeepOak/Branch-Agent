// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): the sidebar's "couldn't load the list" line showed the engine's raw words. It reads
// through plainError() now. main's ERROR_LEAD already drops an engine's bare "Error:" label; the cases below pin that the
// sidebar line gets the same reading. Advanced keeps the engine's words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../connect/capabilities";
import type { ConversationList } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import type { SaplingSession } from "../connect/session";
import { Sidebar, type SidebarProps } from "../screens/sidebar/Sidebar";
import { plainError } from "./plain-error";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
vi.mock("./use-status", () => ({ useUpdate: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|\/home\/|TypeError|:\d+:\d+|config\.get|^Error:/;
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const FAILURES = [
  "unknown method: sessions.list",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "Error: connect ECONNREFUSED 127.0.0.1:18789",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllGlobals(); });

async function sidebarLine(error: string): Promise<string> {
  const answers: Record<string, unknown> = {
    "contacts.list": { contacts: [] }, "agents.list": { defaultId: "sapling", agents: [] }, "rooms.list": { rooms: [] }, "a2a.peers.list": { peers: [] },
    "users.self": { profile: { id: "me", displayName: "Me" } }, "users.list": { profiles: [] },
  };
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  const engine = { request, features: { methods: ["contacts.list", "agents.list", "rooms.list"], events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null },
    onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(), error,
  };
  await act(async () => root.render(<CapabilityProvider engine={engine as unknown as WindowEngine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
  return host.querySelector(".r1sb-error")?.textContent ?? "";
}

describe("the sidebar's list line reads plain at Regular (Private #1089)", () => {
  it("an engine's bare Error: label never shows as a lead (main's ERROR_LEAD)", () => {
    expect(plainError("Error: connect ECONNREFUSED 127.0.0.1:18789")).toBe(REACH);
    expect(plainError("Error: Couldn't save: ENOENT: no such file or directory, open '/home/alex/notes.md'")).toBe("Couldn't save. That file or folder isn’t there. Check that it still exists, then try again.");
    expect(plainError("Error: The approval store is busy.")).toBe("The approval store is busy.");
    // A screen's own lead stays, and a named class still picks its sentence.
    expect(plainError("Couldn't change Lockdown: Error: connect ECONNREFUSED 127.0.0.1:18789")).toBe(`Couldn't change Lockdown. ${REACH}`);
    expect(plainError("CodexNotInstalledError: Codex is not installed.")).toBe("That isn’t installed on this computer. Install it, then try again.");
  });

  it.each(FAILURES)("the sidebar's list line: %j", async (raw) => {
    const line = await sidebarLine(raw);
    expect(line).not.toBe("");
    expect(line).not.toMatch(RAW);
  });

  it("Advanced keeps the engine's words", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(plainError("Error: connect ECONNREFUSED 127.0.0.1:18789")).toBe("connect ECONNREFUSED 127.0.0.1:18789");
    expect(await sidebarLine(FAILURES[0])).toBe(FAILURES[0]);
  });
});
