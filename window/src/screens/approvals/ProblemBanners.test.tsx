// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { SaplingSession } from "../../connect/session";
import { undeclaredControls } from "../../glass/coming-registry";
import { clearBanner } from "../../shell/Banner";
import { ApprovalsLayer } from "./ApprovalsLayer";
import { useProblemBannerRows } from "./ProblemBanners";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; clearBanner(); document.body.innerHTML = ""; });

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

/** A connection with a phase it can change, channels.status answers and gateway events it can send. */
function sessionOf(statuses: unknown[]) {
  let phase = "connected";
  const watchers = new Set<() => void>();
  const events = new Set<(event: string, payload: unknown) => void>();
  const request = vi.fn(async (method: string) => (method === "channels.status" ? statuses.shift() ?? {} : {}));
  const session = {
    subscribe: (fn: () => void) => { watchers.add(fn); return () => watchers.delete(fn); },
    getSnapshot: () => ({ status: { phase } }),
    request,
    onGatewayEvent: (fn: (event: string, payload: unknown) => void) => { events.add(fn); return () => events.delete(fn); },
  } as unknown as SaplingSession;
  return {
    session,
    setPhase: async (next: string) => { phase = next; await act(async () => watchers.forEach((fn) => fn())); await settle(); },
    emit: async (event: string, payload: unknown) => { await act(async () => events.forEach((fn) => fn(event, payload))); await settle(); },
  };
}
const engineOf = (methods: string[]) => ({ features: { methods, events: [] }, request: vi.fn(async () => []), onEvent: () => () => undefined, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] }) as unknown as WindowEngine;

type Calls = { onOpen: (key: string) => void; onAsk: (text: string) => void; onOpenConnection: () => void };
function Window({ session, engine, calls, view }: { session: SaplingSession; engine: WindowEngine; calls: Calls; view: "chat" | "other" }) {
  const more = useProblemBannerRows({ session, shownKey: view === "chat" ? "agent:main:main" : null, machineName: "Studio", defaultName: "Sapling",
    titleOf: (key) => (key === "agent:ledger:main" ? "Invoices" : "A conversation"), trunkOf: () => "Ledger", ...calls });
  return <ApprovalsLayer engine={engine} sessionKey={view === "chat" ? "agent:main:main" : null} view={view} onOpen={calls.onOpen} more={more} />;
}
async function render(node: React.ReactNode, engine: WindowEngine) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}>{node}</CapabilityProvider>));
  await settle();
  return host;
}
const banners = () => [...document.querySelectorAll("[data-testid=r1-banner]")];
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); await settle(); };

describe("R1 problem banners (Classic hooks in the R1 Banners shell)", () => {
  it("raises Can’t reach <computer> in the banner stack when the connection drops, and Open connection goes there", async () => {
    const { session, setPhase } = sessionOf([]);
    const calls = { onOpen: vi.fn(), onAsk: vi.fn(), onOpenConnection: vi.fn() };
    await render(<Window session={session} engine={engineOf([])} calls={calls} view="chat" />, engineOf([]));
    expect(banners()).toHaveLength(0);
    await setPhase("connecting");
    expect(banners()).toHaveLength(1);
    expect(banners()[0].querySelector("b")?.textContent).toBe("Can’t reach Studio");
    expect(banners()[0].textContent).toContain("Branch keeps trying.");
    expect(banners()[0].className).toBe("r1-banner g-clear");
    expect(banners()[0].querySelector(".r1-banner-icon")?.getAttribute("data-icon")).toBe("alert");
    expect(undeclaredControls(document.body).map((e) => e.textContent)).toEqual([]);
    await click(banners()[0].querySelector("[data-testid=banner-action]")!);
    expect(calls.onOpenConnection).toHaveBeenCalledOnce();
    await settle();
    expect(document.querySelector("[data-testid=r1-banner]:not([data-gone])")).toBeNull();
  });

  it("shows a finished conversation that is off screen with Open, and leaves approvals to the approvals banners", async () => {
    const { session, emit } = sessionOf([]);
    const calls = { onOpen: vi.fn(), onAsk: vi.fn(), onOpenConnection: vi.fn() };
    await render(<Window session={session} engine={engineOf([])} calls={calls} view="other" />, engineOf([]));
    await emit("exec.approval.requested", { request: { sessionKey: "agent:ledger:main", command: "rm -rf build" } });
    expect(banners()).toHaveLength(0);
    await emit("chat", { state: "final", sessionKey: "agent:ledger:main", message: { content: "## Sent the invoice\nmore" } });
    expect(banners()).toHaveLength(1);
    expect(banners()[0].querySelector("b")?.textContent).toBe("Invoices");
    expect(banners()[0].textContent).toContain("Sent the invoice");
    await click(banners()[0].querySelector("[data-testid=banner-open]")!);
    expect(calls.onOpen).toHaveBeenCalledWith("agent:ledger:main");
  });

  it("raises a chat app disconnect with Ask <default Trunk>, Coming until chat.send, then sending the question", async () => {
    const connected = { channelLabels: { telegram: "Telegram" }, channelAccounts: { telegram: [{ connected: true }] } };
    const gone = { channelLabels: { telegram: "Telegram" }, channelAccounts: { telegram: [{ connected: false }] } };
    for (const methods of [[], ["chat.send"]]) {
      const { session, emit } = sessionOf([connected, gone]);
      const calls = { onOpen: vi.fn(), onAsk: vi.fn(), onOpenConnection: vi.fn() };
      const engine = engineOf(methods);
      await render(<Window session={session} engine={engine} calls={calls} view="chat" />, engine);
      await emit("channels.changed", {});
      expect(banners()).toHaveLength(1);
      expect(banners()[0].querySelector("b")?.textContent).toBe("Telegram just disconnected");
      const ask = banners()[0].querySelector<HTMLButtonElement>("[data-testid=banner-action]")!;
      expect(ask.textContent).toBe("Ask Sapling");
      expect(ask.getAttribute("aria-disabled")).toBe(methods.length ? null : "true");
      await click(ask);
      expect(calls.onAsk.mock.calls).toEqual(methods.length ? [["What happened to Telegram?"]] : []);
      await act(async () => root!.unmount()); root = undefined; clearBanner(); document.body.innerHTML = "";
    }
  });

  it("dismisses with × and counts a repeat as ×2 instead of a second banner", async () => {
    const { session, setPhase } = sessionOf([]);
    const calls = { onOpen: vi.fn(), onAsk: vi.fn(), onOpenConnection: vi.fn() };
    await render(<Window session={session} engine={engineOf([])} calls={calls} view="chat" />, engineOf([]));
    await setPhase("connecting");
    await setPhase("connected");
    await setPhase("connecting");
    expect(banners()).toHaveLength(1);
    expect(banners()[0].querySelector("b")?.textContent).toBe("Can’t reach Studio ×2");
    await click(banners()[0].querySelector("[aria-label=Dismiss]")!);
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    await settle();
    expect(banners()).toHaveLength(0);
  });

  it("starts the 6 s timer again when a repeat arrives, so a late ×2 stays its full time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
      const { session } = sessionOf([]);
      let phase = "connected";
      const watchers = new Set<() => void>();
      Object.assign(session, { subscribe: (fn: () => void) => { watchers.add(fn); return () => watchers.delete(fn); }, getSnapshot: () => ({ status: { phase } }) });
      const setPhase = async (next: string) => { phase = next; await act(async () => watchers.forEach((fn) => fn())); await tick(10); };
      const calls = { onOpen: vi.fn(), onAsk: vi.fn(), onOpenConnection: vi.fn() };
      const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
      const engine = engineOf([]);
      await act(async () => root!.render(<CapabilityProvider engine={engine}><Window session={session} engine={engine} calls={calls} view="chat" /></CapabilityProvider>));
      await tick(10);
      await setPhase("connecting");
      expect(banners()).toHaveLength(1);
      await tick(5000);
      await setPhase("connected");
      await setPhase("connecting");
      expect(banners()[0].querySelector("b")?.textContent).toBe("Can’t reach Studio ×2");
      // Past the first banner's 6 s and its leave time: the repeat is still up, and not leaving.
      await tick(3000);
      expect(document.querySelectorAll("[data-testid=r1-banner]:not([data-gone])")).toHaveLength(1);
      await tick(3500);
      expect(banners()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
