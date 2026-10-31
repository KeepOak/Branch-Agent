// @vitest-environment jsdom
// #479, the older Add a Trunk dialog (Classic window): the Trunk was made, then its conversation could not open.
// The dialog closes, one plain message says so without engine words, and Try again opens it without a second create.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import { WindowShell } from "./WindowShell";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
vi.mock("../places/trunk/NewTrunkPreview", () => ({
  NewTrunkPreview: ({ onConfirm }: { onConfirm: (choice: { name: string; avatar: string }) => void }) => (
    <div data-testid="new-trunk-preview">
      <button type="button" onClick={() => onConfirm({ name: "Hazel", avatar: "classic" })}>Make Trunk</button>
    </div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

function stubChrome() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

it("closes Add a Trunk once the Trunk exists, says plainly its conversation couldn't open, and Try again opens it", async () => {
  const snapshot = {
    status: { phase: "connected" }, sessionKey: "agent:oak:main", mainKey: "agent:oak:main", name: "Oak",
    history: [], live: [], pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null,
    doneAt: null, lastActivityAt: 10, error: null, steered: [], ended: null,
  };
  let created = false;
  let storeBusy = true;
  let sessions: Array<Record<string, unknown>> = [{ key: "agent:oak:main", agentId: "oak", isMain: true, sessionId: "s-main", updatedAt: 10 }];
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } };
    if (method === "agents.create") { created = true; return { agentId: "hazel" }; }
    if (method === "agents.list") return { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", name: "Oak" }, ...(created ? [{ id: "hazel", name: "Hazel" }] : [])] };
    if (method === "sessions.create") {
      if (storeBusy) throw new Error("UNAVAILABLE: session store witness mismatch for agent hazel");
      sessions = [...sessions, { key: params?.key, agentId: "hazel", isMain: true, sessionId: "s-hazel", updatedAt: 20 }];
      return { key: params?.key };
    }
    if (method === "sessions.describe") return { session: sessions.find((row) => row.key === params?.key) ?? null };
    if (method === "contacts.list") return { contacts: [] };
    if (method === "contacts.topics") return { topics: [] };
    if (method === "sessions.subscribe") return { list: { sessions } };
    if (method === "sessions.list") return { sessions };
    if (method === "chat.history") return { messages: [] };
    if (method === "rooms.list") return { rooms: [] };
    if (method === "peers.list" || method === "a2a.peers.list") return { peers: [] };
    if (method === "channels.status") return { channelOrder: [] };
    if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return { items: [] };
    return {};
  });
  const open = vi.fn(async () => {});
  const session = {
    request, engine: { request, onEvent: () => () => {}, scopes: ["operator.admin"], agentId: "oak" },
    gatewayUrl: "ws://gateway-479.invalid", getSnapshot: () => snapshot, subscribe: () => () => {},
    onGatewayEvent: () => () => {}, open, reload: vi.fn(),
  } as unknown as SaplingSession;
  stubChrome();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<WindowShell session={session} url="ws://gateway-479.invalid" />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  // Palette › New Trunk opens the older Add a Trunk dialog.
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })); });
  const input = document.querySelector<HTMLInputElement>('[data-testid="palette"] input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New Trunk");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const row = [...document.querySelectorAll<HTMLElement>('[data-testid="palette-row"]')].find((node) => node.querySelector(".pal-label")?.textContent === "New Trunk");
  expect(row).toBeTruthy();
  await act(async () => row!.click());
  const make = await vi.waitFor(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="new-trunk-preview"] button')].find((b) => b.textContent === "Make Trunk");
    expect(button).toBeTruthy();
    return button!;
  });
  await act(async () => make.click());

  const toast = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-testid="toast"]')].find((t) => t.textContent?.includes("couldn’t open"));
    expect(found).toBeTruthy();
    return found!;
  });
  expect(document.querySelector('[data-testid="new-trunk-preview"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem("branch.route") ?? "null")).not.toMatchObject({ key: "agent:hazel:main" });
  expect(toast.textContent).toContain("“Hazel” is ready, but its conversation couldn’t open.");
  const shown = [...document.querySelectorAll('[data-testid="toast"]')].map((t) => t.textContent).join(" ");
  expect(shown).not.toContain("witness mismatch");
  expect(shown).not.toContain("Couldn't start a conversation");

  storeBusy = false;
  const retry = [...toast.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Try again");
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("branch.route") ?? "null")).toMatchObject({ kind: "chat", key: "agent:hazel:main" }));
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(1);
});
