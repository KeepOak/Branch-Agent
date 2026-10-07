// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import type { UpdateInfo } from "./status-data";
import { useUpdate } from "./use-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let current: UpdateInfo | null = null;
const session = { gatewayUrl: "ws://example.test:19031" } as SaplingSession;

function Fixture() {
  current = useUpdate(session, true, "0.4.3-build-old1234");
  return null;
}

async function mount() {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Fixture />));
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; current = null;
  document.body.replaceChildren();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.unstubAllGlobals();
});

it("reads the latest Branch component release in a browser window", async () => {
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: "v0.4.4-build-new5678", assets: [{ name: "branch-release-win32-x64.json" }] }) }));
  vi.stubGlobal("fetch", request);
  await mount();
  expect(request).toHaveBeenCalledWith("https://api.github.com/repos/KeepOak/Branch-Agent/releases/latest", expect.objectContaining({ cache: "no-store" }));
  expect(current?.latest).toBe("0.4.4-build-new5678");
  expect(current?.statusMessage).toBeUndefined();
});

it("reports a release-feed failure instead of claiming Branch is current", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));
  await mount();
  expect(current?.latest).toBeNull();
  expect(current?.statusMessage).toBe("Release check failed (403)");
});

it("reads releases for a remote gateway even when a desktop bridge exists", async () => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: "ws://127.0.0.1:19621", componentUpdates: { status: vi.fn() } };
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: "v0.4.4-build-new5678", assets: [{ name: "branch-release-linux-x64.json" }] }) }));
  vi.stubGlobal("fetch", request);
  await mount();
  expect(current?.latest).toBe("0.4.4-build-new5678");
  expect(request).toHaveBeenCalledOnce();
});

it("keeps the desktop update bridge authoritative without fetching releases", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: session.gatewayUrl, componentUpdates: {
    status: async () => ({ phase: "available", currentVersion: "0.4.3-build-old1234", latestVersion: "0.4.4-build-new5678", pendingVersion: null, checkedAt: 1, error: null }),
  } };
  await mount();
  expect(current?.latest).toBe("0.4.4-build-new5678");
  expect(request).not.toHaveBeenCalled();
});
