// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./connect/gateway";

type Options = { url: string; onStatus: (status: GatewayStatus) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options }> }));
vi.mock("./connect/gateway", () => ({
  BranchGateway: class {
    options: Options;
    constructor(options: Options) { this.options = options; fake.gateways.push(this); }
    start(): void { this.options.onStatus({ phase: "connecting" }); }
    stop(): void {}
    reconnectNow(): void {}
    async request(method: string): Promise<unknown> {
      if (method === "chat.history") return { messages: [] };
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
      if (method === "approval.history" || method === "exec.approval.list") return { items: [] };
      return {};
    }
  },
}));
vi.mock("./shell/WindowShell", () => ({
  WindowShell: () => <div data-testid="resident-window" />,
}));

const url = "ws://127.0.0.1:1";
const otherUrl = "ws://127.0.0.1:2";
const marker = "branch.window.residentUrl";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: "agent:main:main" } }, auth: { scopes: [] }, policy: {} };
let root: Root | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: url, gatewayToken: "test-token" };
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
  const { App } = await import("./App");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  return host;
}
async function connected() {
  await act(async () => fake.gateways[0]!.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus));
}

it.each([[url, url], [`${url}/`, url], [url, `${url}/`]])("keeps the resident window while reconnecting after a reload of the same target (%s, %s)", async (storedUrl, desktopUrl) => {
  sessionStorage.setItem(marker, storedUrl);
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: desktopUrl, gatewayToken: "test-token" };
  const host = await mount();
  expect(host.querySelector('[data-testid="resident-window"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Starting Branch");
});

it("shows Starting Branch on a fresh window without a resident marker", async () => {
  const host = await mount();
  expect(host.querySelector('[data-testid="resident-window"]')).toBeNull();
  expect(host.textContent).toContain("Starting Branch");
});

it("does not reuse a resident marker from a different target", async () => {
  sessionStorage.setItem(marker, otherUrl);
  const host = await mount();
  expect(host.querySelector('[data-testid="resident-window"]')).toBeNull();
  expect(host.textContent).toContain("Starting Branch");
});

it("records the connected target and keeps the shell through a reload", async () => {
  const host = await mount();
  expect(sessionStorage.getItem(marker)).toBeNull();
  await connected();
  expect(sessionStorage.getItem(marker)).toBe(url);
  expect(host.querySelector('[data-testid="resident-window"]')).not.toBeNull();
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetModules();
  const reloaded = await mount();
  expect(reloaded.querySelector('[data-testid="resident-window"]')).not.toBeNull();
  expect(reloaded.textContent).not.toContain("Starting Branch");
});

it("keeps the resident window after a local engine handoff and reload", async () => {
  let currentUrl = url;
  (window as { branchDesktop?: unknown }).branchDesktop = {
    gatewayUrl: url, getGatewayUrl: () => currentUrl, gatewayToken: "test-token",
  };
  const host = await mount();
  await connected();
  expect(sessionStorage.getItem(marker)).toBe(url);

  // Production preload stores and dispatches new URL(next).href, including its trailing slash.
  currentUrl = new URL(otherUrl).href;
  await act(async () => window.dispatchEvent(new CustomEvent("branch:engine-handoff", {
    detail: { gatewayUrl: currentUrl },
  })));
  expect(fake.gateways).toHaveLength(2);
  const successor = fake.gateways[1]!;
  expect(successor.options.url).toBe(currentUrl);
  await act(async () => successor.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus));
  expect(sessionStorage.getItem(marker)).toBe(currentUrl);
  expect(host.querySelector('[data-testid="resident-window"]')).not.toBeNull();

  await act(async () => root?.unmount());
  root = undefined;
  vi.resetModules();
  // After reload, branch-desktop:info provides the target without a trailing slash.
  currentUrl = otherUrl;
  (window as { branchDesktop?: unknown }).branchDesktop = {
    gatewayUrl: currentUrl, getGatewayUrl: () => currentUrl, gatewayToken: "test-token",
  };
  const reloaded = await mount();
  expect(fake.gateways).toHaveLength(3);
  expect(fake.gateways[2]!.options.url).toBe(otherUrl);
  expect(reloaded.querySelector('[data-testid="resident-window"]')).not.toBeNull();
  expect(reloaded.textContent).not.toContain("Starting Branch");
});

it("clears the resident marker when switching computers", async () => {
  const host = await mount();
  await connected();
  await act(async () => window.dispatchEvent(new CustomEvent("branch:switch-computer", {
    detail: { url: otherUrl, key: "test-token" },
  })));
  expect(sessionStorage.getItem(marker)).toBeNull();
  expect(host.querySelector('[data-testid="resident-window"]')).toBeNull();
  expect(host.textContent).toContain("Starting Branch");
});
