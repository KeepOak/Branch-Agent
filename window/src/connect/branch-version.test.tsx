// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StatusBar } from "../shell/StatusBar";
import { UpdatesPage } from "../places/settings/set2/updates";
import { BRANCH_VERSION_TIP, isNewerBranchVersion, runningBranchVersion, useBranchVersion } from "./branch-version";
import type { WindowEngine } from "./engine";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div"); document.body.append(host);
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); host.replaceChildren(); root = createRoot(host); delete (window as { branchDesktop?: unknown }).branchDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Bar() {
  const version = useBranchVersion("ws://127.0.0.1:19621");
  return <StatusBar connection="connected" gateway="on" machineName="Elm" roomUsed={null} running={0} version={version} usage={null} open={null} onItem={() => {}} />;
}

it("status bar shows Branch desktop version, not engine version", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: "ws://127.0.0.1:19621", componentUpdates: {
    status: async () => ({ phase: "current", currentVersion: "0.4.4-build-a300a48dba2f", latestVersion: null, pendingVersion: null, checkedAt: 1, error: null }),
  } };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  await act(async () => root.render(<Bar />));
  const button = host.querySelector<HTMLElement>('[data-testid="sb-version"]');
  expect(button?.getAttribute("aria-label")).toBe("Branch 0.4.4");
  expect(button?.textContent).toContain("Branch 0.4.4");
  expect(button?.title).toBe(BRANCH_VERSION_TIP);
  expect(host.textContent).not.toContain("2026.9");
});

it("Updates page uses the Branch desktop component version", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: "ws://127.0.0.1:19621", componentUpdates: {
    status: async () => ({ phase: "current", currentVersion: "0.4.4-build-a300a48dba2f", latestVersion: null, pendingVersion: null, checkedAt: 1, error: null }),
  } };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  const engine = { gatewayUrl: "ws://127.0.0.1:19621", request: vi.fn(async () => ({ runtimeVersion: "2026.9.8" })), onEvent: () => () => {}, scopes: [], sessionKey: null } as WindowEngine;
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine} />));
  expect(host.textContent).toContain("Branch 0.4.4 · build a300a48d on this computer");
  expect(host.textContent).toContain("You have Branch 0.4.4 · build a300a48d");
  expect(host.textContent).not.toContain("2026.9.8");
});

it("running build prefers the stamped id over a short component version", () => {
  expect(runningBranchVersion("0.4.4", "0.4.4-build-c27f2be23320")).toBe("0.4.4-build-c27f2be23320");
  expect(runningBranchVersion("0.4.4-build-a300a48dba2f", "0.4.4-build-c27f2be23320")).toBe("0.4.4-build-a300a48dba2f");
});

it("treats a leftover older staged shell as not newer than the running build", () => {
  expect(isNewerBranchVersion("4b72e314c692", "0.4.4-build-c27f2be23320")).toBe(false);
  expect(isNewerBranchVersion("0.4.4-build-c27f2be23320", "0.4.4-build-c27f2be23320")).toBe(false);
  expect(isNewerBranchVersion("1.1", "1.0")).toBe(true);
  expect(isNewerBranchVersion("0.4.5-build-abc12345def0", "0.4.4-build-c27f2be23320")).toBe(true);
});

it("browser-only status uses the shipped window stamp", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "0.4.4-build-a300a48dba2f\n" })));
  await act(async () => root.render(<Bar />));
  expect(host.querySelector('[data-testid="sb-version"]')?.getAttribute("aria-label")).toBe("Branch 0.4.4");
});
