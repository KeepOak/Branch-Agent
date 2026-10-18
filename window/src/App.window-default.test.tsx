// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./connect/gateway";

// Which window a connected install gets. R1 is the default; Classic only behind ?classic or branch.classic (R1-12).
type Options = { url: string; onStatus: (status: GatewayStatus) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options }> }));
vi.mock("./connect/gateway", () => ({
  BranchGateway: class {
    options: Options;
    constructor(options: Options) { this.options = options; fake.gateways.push(this); }
    start(): void { this.options.onStatus({ phase: "connecting" }); }
    stop(): void {}
    reconnectNow(): void {}
    async request(): Promise<unknown> { return {}; }
  },
}));
vi.mock("./shell/WindowShell", () => ({ WindowShell: () => <div data-window="classic" /> }));
vi.mock("./screens/frame/R1Window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screens/frame/R1Window")>()),
  R1Window: () => <div data-window="r1" />,
}));

const url = "ws://127.0.0.1:1";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: "agent:main:main" } }, auth: { scopes: [] }, policy: {} };
let root: Root | undefined;
// Same warmup as App.window-swap: the first mount used to pay the cold transform of App and sit
// on the 5 s per-test limit on slower Windows runners. Load App here so that cost is not a test timeout.
beforeAll(async () => {
  await import("./App");
  vi.resetModules();
}, 60_000);
afterAll(() => {
  vi.resetModules();
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: url, gatewayToken: "test-token" };
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  fake.gateways.length = 0;
  document.body.replaceChildren();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
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
async function reload() {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.resetModules();
  return mount();
}
const shown = (host: HTMLElement) => host.querySelector("[data-window]")?.getAttribute("data-window") ?? null;

async function windowThroughReload(): Promise<[string | null, string | null]> {
  const host = await mount();
  await act(async () => fake.gateways[0]!.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus));
  const first = shown(host);
  return [first, shown(await reload())];
}

it("opens the R1 window by default, including after a reload", async () => {
  expect(await windowThroughReload()).toEqual(["r1", "r1"]);
}, 30_000);

it("keeps the Classic override for ?classic, including after a reload", async () => {
  window.history.replaceState(null, "", "/?classic");
  expect(await windowThroughReload()).toEqual(["classic", "classic"]);
}, 30_000);

it("keeps the Classic override for the branch.classic flag, including after a reload", async () => {
  localStorage.setItem("branch.classic", "1");
  expect(await windowThroughReload()).toEqual(["classic", "classic"]);
}, 30_000);
