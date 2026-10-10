// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import type { UpdateInfo } from "./status-data";
import { useUpdate } from "./use-status";
import { VersionPopover } from "./StatusPopovers";
import { WhatsNew } from "./WhatsNew";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let current: UpdateInfo | null = null;
const session = { gatewayUrl: "ws://example.test:19031" } as SaplingSession;

function Fixture({ version = "0.4.3-build-old1234" }: { version?: string }) {
  current = useUpdate(session, true, version);
  return null;
}

async function mount(view: ReactNode = <Fixture />) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(view));
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

const versionCases = [
  { version: "1.4.2", latest: "v1.4.2", ready: false },
  { version: "1.4.2-build-abcdef12", latest: "v1.4.2-build-abcdef123456", ready: false },
  { version: "1.4.2", latest: "1.4.1", ready: false },
  { version: "1.4.2", latest: "1.4.3", ready: true },
  { version: "", latest: "1.4.3", ready: false },
  { version: "1.4.2", latest: "", ready: false },
];

it.each(versionCases)("maps staged $latest against running $version (ready: $ready)", async ({ version, latest, ready }) => {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: session.gatewayUrl, componentUpdates: {
    status: async () => ({ phase: "staged", currentVersion: version, latestVersion: latest, pendingVersion: latest, checkedAt: 1, error: null }),
  } };
  await mount(<Fixture version={version} />);
  expect(current?.latest).toBe(ready ? latest : null);
  expect(current?.installing).toBe(ready);
  expect(current?.waiting).toBe(ready ? "Downloaded. Restart Branch when your work is ready." : null);
});

function updateInfo(version: string, latest: string): UpdateInfo {
  return { current: version, latest, notes: [], installing: false, waiting: null };
}
const noop = () => {};

it.each(versionCases)("renders version popover for $latest against $version (ready: $ready)", async ({ version, latest, ready }) => {
  await mount(<VersionPopover version={version} update={updateInfo(version, latest)} desktopPending={latest} autoApply desktopInstall
    above={{ left: 0, right: 100, top: 100, align: "left" }} onClose={noop} onWhatsNew={noop} onInstall={noop} onRemind={noop} />);
  expect(Boolean(document.querySelector('[data-testid="ver-install"]'))).toBe(ready);
  expect(Boolean(document.querySelector('[data-testid="ver-remind"]'))).toBe(ready);
  expect(document.body.textContent?.includes("is ready")).toBe(ready);
  expect(document.body.textContent?.includes("Update ready, applying")).toBe(ready);
  if (ready) expect(document.body.textContent).toContain("Branch 1.4.3 is ready");
});

it.each(versionCases)("renders What's new for $latest against $version (ready: $ready)", async ({ version, latest, ready }) => {
  await mount(<WhatsNew version={version} update={updateInfo(version, latest)} installed={{ New: [], Better: [], Fixed: [] }}
    startOnReady desktopInstall onClose={noop} onOpenUpdates={noop} onInstall={noop} />);
  expect(Boolean(document.querySelector('[data-testid="wn-install"]'))).toBe(ready);
  expect(document.body.textContent?.includes("· ready")).toBe(ready);
  expect(document.body.textContent?.includes("The update didn't say what it changes.")).toBe(ready);
  if (ready) expect(document.body.textContent).toContain("Branch 1.4.3 · ready");
});

it("removes ready actions when the running version catches up while What's new stays open", async () => {
  const view = (version: string) => <WhatsNew version={version} update={updateInfo(version, "1.4.3")}
    installed={{ New: [{ icon: "check", title: "Installed change", line: "Available now", run: noop }], Better: [], Fixed: [] }}
    startOnReady desktopInstall onClose={noop} onOpenUpdates={noop} onInstall={noop} />;
  await mount(view("1.4.2"));
  expect(document.querySelector('[data-testid="wn-install"]')).not.toBeNull();
  await act(async () => root?.render(view("1.4.3")));
  expect(document.querySelector('[data-testid="wn-install"]')).toBeNull();
  expect(document.body.textContent).not.toContain("· ready");
  expect(document.body.textContent).not.toContain("The update didn't say what it changes.");
  expect(document.body.textContent).toContain("Installed change");
});
