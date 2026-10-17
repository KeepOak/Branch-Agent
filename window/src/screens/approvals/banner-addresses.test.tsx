// @vitest-environment jsdom
// No hostname, IP address or URL in a problem or approval banner at Regular (card #1095, walkthrough B-026, the #1706
// leftover): the R1 banner rows draw their words through the same plainAddresses() filter as toasts and Classic banners.
// The gateway's host reads "this computer", an IP address or host:port reads "that computer" and a URL reads "the link";
// Advanced and Technical keep the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { SaplingSession } from "../../connect/session";
import { clearBanner, raiseBanner } from "../../shell/Banner";
import { rememberHostnames } from "../../shell/plain-address";
import { ApprovalsLayer } from "./ApprovalsLayer";
import { useProblemBannerRows } from "./ProblemBanners";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; clearBanner(); localStorage.clear(); document.body.innerHTML = ""; });

/** The gateway this window talks to; its host is the computer Branch runs on. */
const GATEWAY = "ws://studio-box:18789";
const HOST = new URL(GATEWAY.replace(/^ws/, "http")).hostname;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

function setup() {
  let phase = "connected";
  const watchers = new Set<() => void>();
  const gateway = new Set<(event: string, payload: unknown) => void>();
  const session = {
    subscribe: (fn: () => void) => { watchers.add(fn); return () => watchers.delete(fn); },
    getSnapshot: () => ({ status: { phase }, gatewayUrl: GATEWAY }),
    request: vi.fn(async () => ({})),
    onGatewayEvent: (fn: (event: string, payload: unknown) => void) => { gateway.add(fn); return () => gateway.delete(fn); },
  } as unknown as SaplingSession;
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const methods = ["plugin.approval.list", "plugin.approval.resolve", "exec.approval.list", "exec.approval.resolve", "agents.list"];
  const engine = { features: { methods, events: [] }, request: vi.fn(async () => []), onEvent: (fn: (e: { event: string; payload?: unknown }) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  return {
    session, engine,
    setPhase: async (next: string) => { phase = next; await act(async () => watchers.forEach((fn) => fn())); await settle(); },
    emit: async (event: string, payload: unknown) => { await act(async () => listeners.forEach((fn) => fn({ event, payload }))); await settle(); },
  };
}
function Window({ session, engine }: { session: SaplingSession; engine: WindowEngine }) {
  // On Linux the engine's computer name falls back to the hostname, which is how B-026 showed it.
  const more = useProblemBannerRows({ session, shownKey: null, machineName: HOST, defaultName: "Sapling", titleOf: () => "A conversation", trunkOf: () => "Ledger",
    onOpen: vi.fn(), onAsk: vi.fn(), onOpenConnection: vi.fn() });
  return <ApprovalsLayer engine={engine} sessionKey={null} view="other" onOpen={vi.fn()} more={more} nameOf={() => "Ledger"} />;
}
async function render(level?: "advanced" | "technical") {
  if (level) localStorage.setItem("branch.level", level);
  const s = setup();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={s.engine}><Window session={s.session} engine={s.engine} /></CapabilityProvider>));
  await settle();
  return s;
}
const bannerText = () => [...document.querySelectorAll("[data-testid=r1-banner]")].map((b) => b.querySelector(".r1-banner-text")?.textContent ?? "");
const ASK = { id: "p1", request: { title: `Open ${GATEWAY}/ui on ${HOST} (10.0.0.5:18789)?`, agentId: "ledger", sessionKey: "agent:ledger:main", allowedDecisions: ["allow-once", "deny"] } };

describe("problem and approval banners at Regular", () => {
  it("never show the gateway's host, an IP address or a URL, even when the hostname arrives after the banner", async () => {
    const { setPhase, emit } = await render();
    await setPhase("connecting");
    await act(async () => { raiseBanner({ title: `Couldn’t reach ${HOST}`, text: `${GATEWAY} didn’t answer.`, icon: "alert" }); });
    // The computer's hostname comes from system.info after the connection drops and the banner is raised.
    rememberHostnames(HOST);
    await emit("plugin.approval.requested", ASK);
    const texts = bannerText();
    expect(texts.length).toBeGreaterThanOrEqual(2);
    for (const text of texts) {
      expect(text).not.toContain(HOST);
      expect(text).not.toMatch(/wss?:\/\/|https?:\/\/|\d+\.\d+\.\d+\.\d+/);
    }
    expect(texts.join(" | ")).toContain("Couldn’t reach this computer");
    expect(texts.join(" | ")).toContain("Open the link on this computer (that computer)?");
  });

  it("keep the exact words at Advanced", async () => {
    const { emit } = await render("advanced");
    rememberHostnames(HOST);
    await emit("plugin.approval.requested", ASK);
    expect(bannerText().join(" | ")).toContain(ASK.request.title);
  });
});
