// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayPopover, RunningPopover, UsagePopover, VersionPopover } from "./StatusPopovers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const above = { left: 10, right: 200, top: 700, align: "left" as const };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe("status popovers", () => {
  it("Running: Coming up from cron.list; Pause all and /bg invoke their actions", async () => {
    const request = vi.fn(async () => ({ jobs: [{ name: "Morning brief", enabled: true, state: { nextRunAtMs: Date.now() + 30 * 60_000 } }] }));
    const opened = vi.fn();
    const background = vi.fn(), pauseAll = vi.fn();
    const host = await show(<RunningPopover above={above} onClose={() => {}} request={request as never} working={[{ key: "k", title: "Sapling", line: "Report", runIds: ["run-1"] }]} onOpen={opened} onAutomations={() => {}} onBackground={background} onPauseAll={pauseAll} />);
    expect(request).toHaveBeenCalledWith("cron.list", { limit: 200 });
    expect(host.textContent).toContain("Morning brief");
    expect(host.textContent).toContain("in 30 min");
    const pause = button(host, "Pause all Trunks");
    expect(pause.disabled).toBe(false);
    expect(button(host, "Start something in the background").disabled).toBe(false);
    await act(async () => button(host, "Start something in the background").click());
    await act(async () => pause.click());
    expect(background).toHaveBeenCalledOnce();
    expect(pauseAll).toHaveBeenCalledOnce();
    await act(async () => button(host, "Sapling").click());
    expect(opened).toHaveBeenCalledWith("k");
  });
  it("Gateway: the mode control is greyed with its reason; Restart runs", async () => {
    const restart = vi.fn();
    const host = await show(<GatewayPopover above={above} onClose={() => {}} level="regular" facts={{ health: { ok: true, durationMs: 4, checkedAt: 1 }, error: null, uptimeMs: 3_600_000, connectedAt: Date.now() }} onRestart={restart} onSettings={() => {}} />);
    expect(host.textContent).toContain("On · up 1 hour");
    expect(host.textContent).toContain("answered in 4 ms");
    expect([...host.querySelectorAll(".sp-seg button")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(host.textContent).toContain("can't change it yet");
    await act(async () => button(host, "Restart the engine").click());
    expect(restart).toHaveBeenCalled();
  });
  it("Usage: rows and account labels come from seeded limits", async () => {
    const request = vi.fn(async () => ({}));
    const limits = { updatedAt: Date.now(), refreshing: false, rows: [{ id: "a", name: "Plan", account: "", pill: "Measured" as const, windows: [{ name: "Today", left: 40, reset: "", low: false }], line: "as of just now" }] };
    const host = await show(<UsagePopover above={above} onClose={() => {}} limits={limits} request={request as never} onOpenUsage={() => {}} />);
    expect(request).not.toHaveBeenCalled();
    expect(host.textContent).toContain("40% left");
    expect(host.textContent).toContain("Checked just now");
  });
  it("Version: up to date has no install item", async () => {
    const host = await show(<VersionPopover above={above} onClose={() => {}} update={{ current: "1.0.0", latest: null, notes: [], installing: false, waiting: null }} version="1.0.0" onWhatsNew={() => {}} onInstall={() => {}} onRemind={() => {}} />);
    expect(host.textContent).toContain("Branch is up to date.");
    expect(button(host, "Install when idle")).toBeUndefined();
  });
  it("Version: ready label keeps the build id out of the popover", async () => {
    const host = await show(<VersionPopover above={above} onClose={() => {}} update={{ current: "0.4.4-build-current", latest: "0.4.5-build-next", notes: [], installing: false, waiting: null }} version="0.4.4-build-current" onWhatsNew={() => {}} onInstall={() => {}} onRemind={() => {}} />);
    expect(host.textContent).toContain("Branch 0.4.5 is ready");
    expect(host.textContent).not.toContain("-build-next");
  });
  it("Version: install when idle is only available in the desktop app", async () => {
    const update = { current: "1.0.0", latest: "1.1.0", notes: [], installing: false, waiting: null };
    const install = vi.fn();
    const host = await show(<VersionPopover above={above} onClose={() => {}} update={update} version="1.0.0" desktopInstall onWhatsNew={() => {}} onInstall={install} onRemind={() => {}} />);
    expect(host.textContent).toContain("Installs by itself when nothing is running.");
    await act(async () => button(host, "Install when idle").click());
    expect(install).toHaveBeenCalledOnce();
    await act(async () => root?.render(<VersionPopover above={above} onClose={() => {}} update={update} version="1.0.0" onWhatsNew={() => {}} onInstall={install} onRemind={() => {}} />));
    expect(host.textContent).toContain("Ready to install on the computer running Branch: open Branch there to install it.");
    expect(button(host, "Install when idle")).toBeUndefined();
  });
});
