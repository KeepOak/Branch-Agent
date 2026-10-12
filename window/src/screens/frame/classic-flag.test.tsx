// @vitest-environment jsdom
// The window opens R1 (and with it R1 Settings) by default; Classic, with its own Settings, stays behind the hidden flag.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "../../connect/gateway";

type Options = { url: string; onStatus: (status: GatewayStatus) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options }> }));
vi.mock("../../connect/gateway", () => ({
  BranchGateway: class {
    options: Options;
    constructor(options: Options) { this.options = options; fake.gateways.push(this); }
    start(): void { this.options.onStatus({ phase: "connecting" }); }
    stop(): void {}
    reconnectNow(): void {}
    async request(method: string): Promise<unknown> {
      if (method === "chat.history") return { messages: [] };
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
      return {};
    }
  },
}));
vi.mock("../../shell/WindowShell", () => ({ WindowShell: () => <div data-testid="classic-window" /> }));
vi.mock("./R1Window", async (actual) => ({ ...(await actual<typeof import("./R1Window")>()), R1Window: () => <div data-testid="r1-window" /> }));

const url = "ws://127.0.0.1:1";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: "agent:main:main" } }, auth: { scopes: [] }, policy: {} };
let root: Root | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); localStorage.clear();
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: url, gatewayToken: "test-token" };
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; fake.gateways.length = 0;
  document.body.replaceChildren(); sessionStorage.clear(); localStorage.clear();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.resetModules();
});
async function connectedWindow() {
  const { App } = await import("../../App");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  await act(async () => fake.gateways[0]!.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus));
  return host;
}

it("opens the R1 window (with R1 Settings) by default", async () => {
  const host = await connectedWindow();
  expect(host.querySelector('[data-testid="r1-window"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="classic-window"]')).toBeNull();
});

it("still opens Classic behind its hidden flag", async () => {
  localStorage.setItem("branch.classic", "1");
  const host = await connectedWindow();
  expect(host.querySelector('[data-testid="classic-window"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="r1-window"]')).toBeNull();
});
