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
  it("Running: Coming up from cron.list; Pause all and /bg are greyed with a reason and run nothing", async () => {
    const request = vi.fn(async () => ({ jobs: [{ name: "Morning brief", enabled: true, state: { nextRunAtMs: Date.now() + 30 * 60_000 } }] }));
    const opened = vi.fn();
    const host = await show(<RunningPopover above={above} onClose={() => {}} request={request as never} working={[{ key: "k", title: "Sapling", line: "Report" }]} onOpen={opened} onAutomations={() => {}} />);
    expect(request).toHaveBeenCalledWith("cron.list", { limit: 200 });
    expect(host.textContent).toContain("Morning brief");
    expect(host.textContent).toContain("in 30 min");
    const pause = button(host, "Pause all Trunks");
    expect(pause.disabled).toBe(true);
    expect(pause.title).toMatch(/engine/);
    expect(button(host, "Start something in the background").disabled).toBe(true);
    await act(async () => button(host, "Sapling").click());
    expect(opened).toHaveBeenCalledWith("k");
  });
  it("Gateway: the mode control is greyed with its reason; Restart runs", async () => {
    const restart = vi.fn();
    const host = await show(<GatewayPopover above={above} onClose={() => {}} level="regular" facts={{ health: { ok: true, durationMs: 4, checkedAt: 1 }, error: null, uptimeMs: 3_600_000, connectedAt: Date.now() }} onRestart={restart} onSettings={() => {}} />);
    expect(host.textContent).toContain("On. Up 1 hour.");
    expect(host.textContent).toContain("Answered in 4 ms");
    expect([...host.querySelectorAll(".sp-seg button")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(host.textContent).toContain("can't change it yet");
    await act(async () => button(host, "Restart the engine").click());
    expect(restart).toHaveBeenCalled();
  });
  it("Usage: rows, the summary and This month from usage.cost", async () => {
    const request = vi.fn(async (method: string) => method === "usage.status"
      ? { updatedAt: Date.now(), providers: [{ provider: "openai", displayName: "Plan", windows: [{ label: "Today", usedPercent: 60 }] }] }
      : { totals: { totalCost: 3.5 } });
    const limits = { updatedAt: Date.now(), refreshing: false, rows: [{ id: "a", name: "Plan", account: "", pill: "Measured" as const, inUse: false, windows: [{ name: "Today", left: 40, reset: "", low: false }], line: "as of just now" }] };
    const host = await show(<UsagePopover above={above} onClose={() => {}} limits={limits} request={request as never} onOpenUsage={() => {}} />);
    expect(request).toHaveBeenCalledWith("usage.cost", expect.objectContaining({ agentScope: "all" }));
    expect(host.textContent).toContain("This month: $3.50");
    expect(host.textContent).toContain("1 of 1 connections report a limit.");
  });
  it("Version: up to date has no install item", async () => {
    const host = await show(<VersionPopover above={above} onClose={() => {}} update={{ current: "1.0.0", latest: null, notes: [], installing: false, waiting: null }} version="1.0.0" onWhatsNew={() => {}} onInstall={() => {}} onRemind={() => {}} />);
    expect(host.textContent).toContain("Branch is up to date.");
    expect(button(host, "Install when nothing is running")).toBeUndefined();
  });
});
