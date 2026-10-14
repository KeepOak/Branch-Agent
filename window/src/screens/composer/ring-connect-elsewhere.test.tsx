// @vitest-environment jsdom
// #974 R1 parity row 17: the ring popover offers "Connect to another Branch…" directly under This computer. It
// dispatches the same branch:connect-elsewhere event as Classic's machine menu, so App shows ConnectElsewhereDialog.
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { undeclaredControls } from "../../glass/coming-registry";
import { machineMenuItems } from "../../shell/MachineMenu";
import { RingPopover } from "./RingPopover";

vi.mock("../../connect/session", () => ({
  SaplingSession: class {
    snapshot = { status: { phase: "connected", hello: {} } };
    getSnapshot = () => this.snapshot;
    subscribe = () => () => {};
    start(): void {}
    stop(): void {}
    reconnectNow(): void {}
    handoff(): void {}
  },
}));
vi.mock("../../shell/WindowShell", () => ({ WindowShell: ({ url }: { url: string }) => <div data-testid="window-shell">{url}</div> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Root[] = [];
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.unstubAllGlobals();
});

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

async function mountRing() {
  const request = vi.fn(async (): Promise<unknown> => ({}));
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request, onEvent: () => () => {}, scopes: ["operator.admin"], features: { methods: [], events: [] } } as unknown as WindowEngine;
  const onClose = vi.fn();
  const anchor = createRef<HTMLButtonElement>();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<><button ref={anchor} type="button" data-local="">ring</button>
    <RingPopover anchor={anchor} onClose={onClose} engine={engine} sessionKey="agent:scout:main" name="Scout" working={false} offline={false} context={null} running={[]} limits={null} onOpen={() => {}} onOpenConversation={() => {}} /></>));
  await flush();
  return { onClose, row: () => document.querySelector<HTMLButtonElement>('[data-testid="ring-connect-elsewhere"]') };
}

it("shows Connect to another Branch… directly under This computer, declared local", async () => {
  const { row } = await mountRing();
  const button = row();
  expect(button).not.toBeNull();
  expect(button!.textContent).toBe("Connect to another Branch…");
  expect(button!.previousElementSibling?.getAttribute("data-part")).toBe("this-computer");
  expect(undeclaredControls(document.querySelector(".r1c-ringpop")!)).not.toContain(button);
});

it("clicking it closes the popover and dispatches branch:connect-elsewhere", async () => {
  const heard = vi.fn();
  window.addEventListener("branch:connect-elsewhere", heard, { once: true });
  const { onClose, row } = await mountRing();
  await act(async () => row()!.click());
  expect(onClose).toHaveBeenCalled();
  expect(heard).toHaveBeenCalledTimes(1);
});

it("clicking it opens ConnectElsewhereDialog in the window", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: "ws://127.0.0.1:19621", gatewayToken: "k" };
  localStorage.setItem("branch.classic", "1");
  const { App } = await import("../../App");
  const appHost = document.body.appendChild(document.createElement("div"));
  const appRoot = createRoot(appHost); roots.push(appRoot);
  await act(async () => appRoot.render(<App />));
  expect(document.querySelector("[data-testid=connect-elsewhere]")).toBeNull();
  const { row } = await mountRing();
  await act(async () => row()!.click());
  await flush();
  expect(document.querySelector("[data-testid=connect-elsewhere]")).not.toBeNull();
}, 30_000);

it("leaves Classic's machine menu entry unchanged", () => {
  const heard = vi.fn();
  window.addEventListener("branch:connect-elsewhere", heard, { once: true });
  const rows = machineMenuItems({ machineName: "Home", currentUrl: "ws://127.0.0.1:19031", homeUrl: "ws://127.0.0.1:19031", online: true, level: "regular", roundTripMs: null, openSettings: () => {}, onLinkBranch: () => {}, onSwitch: () => {} });
  const entry = rows.find((row) => "testid" in row && row.testid === "machine-elsewhere");
  expect(entry).toMatchObject({ label: "Connect to a Branch elsewhere…" });
  (entry as { run: () => void }).run();
  expect(heard).toHaveBeenCalledTimes(1);
});
