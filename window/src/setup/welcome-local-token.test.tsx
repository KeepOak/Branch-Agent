// @vitest-environment jsdom
// Get started / Set up later pass an empty key. startKey must still send the desktop preload token
// (`window.branchDesktop.gatewayToken` from desktop/src/preload.ts) to a token-protected local gateway.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "../connect/gateway";

type Options = { url: string; sharedToken?: string; onStatus: (status: GatewayStatus) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options }> }));
vi.mock("../connect/gateway", () => ({
  BranchGateway: class {
    options: Options;
    constructor(options: Options) {
      this.options = options;
      fake.gateways.push(this);
    }
    start(): void {
      if (!this.options.sharedToken) {
        this.options.onStatus({ phase: "failed", code: "AUTH_TOKEN_MISSING", message: "token missing" });
        return;
      }
      this.options.onStatus({ phase: "connecting" });
    }
    stop(): void {}
    reconnectNow(): void {}
    async request(): Promise<unknown> {
      return {};
    }
  },
}));
vi.mock("../shell/WindowShell", () => ({ WindowShell: () => <div data-testid="resident-window" /> }));

const url = "ws://127.0.0.1:18791";
const token = "desktop-preload-token";
let root: Root | undefined;
beforeAll(async () => {
  await import("../App");
  vi.resetModules();
}, 60_000);
afterAll(() => {
  vi.resetModules();
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem("branch.classic", "1");
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  fake.gateways.length = 0;
  document.body.replaceChildren();
  sessionStorage.clear();
  localStorage.clear();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.resetModules();
});

async function mount() {
  const { App } = await import("../App");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  return host;
}

it("Get started retries a token-protected local gateway with the desktop preload token", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: url, gatewayToken: token };
  const host = await mount();
  expect(fake.gateways[0]?.options.sharedToken).toBe(token);
  await act(async () => fake.gateways[0]!.options.onStatus({ phase: "failed", code: "UNAVAILABLE", message: "gateway starting" }));
  expect(host.querySelector('[data-testid="setup"]')).not.toBeNull();
  await act(async () => (host.querySelector('[data-testid="setup-next"]') as HTMLButtonElement).click());
  expect(fake.gateways).toHaveLength(2);
  expect(fake.gateways[1]!.options.sharedToken).toBe(token);
  expect(fake.gateways[1]!.options.url).toBe(url);
  expect(host.textContent).toContain("Starting Branch");
  expect(host.querySelector('[data-testid="setup-problem"]')).toBeNull();
});

it("Set up later retries a token-protected local gateway with the desktop preload token", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: url, gatewayToken: token };
  const host = await mount();
  await act(async () => fake.gateways[0]!.options.onStatus({ phase: "failed", code: "UNAVAILABLE", message: "gateway starting" }));
  await act(async () => (host.querySelector('[data-testid="setup-skip"]') as HTMLButtonElement).click());
  expect(fake.gateways[1]!.options.sharedToken).toBe(token);
});

it("asks for a key on this computer when no preload token exists, then connects with it", async () => {
  const host = await mount();
  expect(host.querySelector('[data-testid="setup"]')).not.toBeNull();
  expect(fake.gateways).toHaveLength(0);
  await act(async () => (host.querySelector('[data-testid="setup-next"]') as HTMLButtonElement).click());
  const key = host.querySelector('[data-testid="setup-key"]') as HTMLInputElement;
  expect(key).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(key, "typed-local-token");
    key.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (host.querySelector('[data-testid="setup-next"]') as HTMLButtonElement).click());
  expect(fake.gateways).toHaveLength(1);
  expect(fake.gateways[0]!.options.sharedToken).toBe("typed-local-token");
  expect(fake.gateways[0]!.options.url).toBe("ws://127.0.0.1:18789");
});
