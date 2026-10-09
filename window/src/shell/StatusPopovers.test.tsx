// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayPopover, RunningPopover, UsagePopover, VersionPopover } from "./StatusPopovers";
import { readLimits, resetWords } from "./status-data";

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
  it("Usage: a flat Every account row with left · reset and this week used", async () => {
    const request = vi.fn(async (method: string) => method === "usage.status"
      ? { updatedAt: Date.now(), providers: [{ provider: "openai-codex", displayName: "ChatGPT plan", accountEmail: "you@example.com", plan: "Plus", windows: [{ label: "5h", usedPercent: 60, resetAt: Date.now() + 6 * 3_600_000 }, { label: "Week", usedPercent: 30 }] }] }
      : {});
    const limits = { updatedAt: Date.now(), refreshing: false, rows: [{ id: "a", name: "ChatGPT · Account 1", email: "you@example.com", plan: "Plus", account: "you@example.com · Plus", pill: "Measured" as const, windows: [{ name: "This 5-hour window", left: 40, reset: "resets 6 PM", low: false }, { name: "This week", left: 70, reset: "", low: false }], line: "as of just now" }] };
    const host = await show(<UsagePopover above={above} onClose={() => {}} limits={limits} request={request as never} onOpenUsage={() => {}} />);
    expect(request).toHaveBeenCalledWith("usage.status", { refresh: true });
    expect(host.querySelector(".sp-provider")).toBeNull();
    expect(host.textContent).toContain("you@example.com");
    expect(host.textContent).toMatch(/40% left · resets /);
    expect(host.textContent).toContain("ChatGPT · Account 1 · Plus · this week 30% used");
    expect(host.querySelector(".meterT5 i")?.getAttribute("style")).toContain("60%");
  });
  it("Usage: each Claude subscription shows what is left, a bar and the reset, or plain words when it shares no number", async () => {
    const at = Date.now() + 2 * 3_600_000;
    const reset = resetWords(at, 1, Date.now());
    const claude = (id: string, used?: number) => ({ provider: "anthropic", displayName: "Claude", authProfileId: `anthropic:${id}`, plan: "Max (20x)", windows: used === undefined ? [] : [{ label: "5h", usedPercent: used, resetAt: at }, { label: "Week", usedPercent: used / 2, resetAt: at + 86_400_000 }] });
    const usage = { updatedAt: Date.now(), providers: [claude("one", 20), claude("two", 50), claude("three", 70), { ...claude("four"), error: "HTTP 429: Rate limited. Please try again later." }, { ...claude("five"), plan: undefined }] };
    const request = vi.fn(async () => usage);
    const host = await show(<UsagePopover above={above} onClose={() => {}} limits={readLimits(usage)} request={request as never} onOpenUsage={() => {}} />);
    const rows = [...host.querySelectorAll(".acctT5")];
    expect(rows.map((row) => row.querySelector(".aNameT5")?.textContent)).toEqual(["Claude · Account 1", "Claude · Account 2", "Claude · Account 3", "Claude · Account 4", "Claude · Account 5"]);
    expect(reset).toMatch(/^resets /);
    expect(rows.slice(0, 3).map((row) => row.querySelector(".aLeftT5")?.textContent)).toEqual([`80% left · ${reset}`, `50% left · ${reset}`, `30% left · ${reset}`]);
    expect(rows.slice(0, 3).map((row) => row.querySelector(".meterT5 i")?.getAttribute("style"))).toEqual(["width: 20%;", "width: 50%;", "width: 70%;"]);
    expect(rows[0].textContent).toContain("Max (20x) · this week 10% used");
    expect(rows[3].querySelector(".meterT5")).toBeNull();
    expect(rows[3].textContent).toContain("Claude · Account 4 didn't share what's left right now. Branch checks again in 5 min.");
    expect(rows[4].textContent).toContain("Claude · Account 5 hasn't shared a limit with Branch.");
    expect(host.textContent).not.toContain("Not shared");
  });
  it("Usage: a measured account that is then rate limited keeps its reading and says how old it is, next to a fresh account", async () => {
    const at = Date.now() + 2 * 3_600_000;
    const claude = (id: string, used: number, extra: Record<string, unknown> = {}) => ({ provider: "anthropic", displayName: "Claude", authProfileId: `anthropic:${id}`, plan: "Max (20x)", windows: [{ label: "5h", usedPercent: used, resetAt: at }], ...extra });
    const measured = { updatedAt: Date.now(), providers: [claude("one", 20), claude("two", 40)] };
    // What usage.status sends after Account 1's next check got HTTP 429 and Account 2's succeeded.
    const rateLimited = { updatedAt: Date.now(), providers: [claude("one", 20, { readingAt: Date.now() - 12 * 60_000, staleReason: "HTTP 429: Rate limited. Please try again later." }), claude("two", 55)] };
    let reply: unknown = measured;
    const request = vi.fn(async () => reply);
    const host = await show(<UsagePopover above={above} onClose={() => {}} limits={readLimits(measured)} request={request as never} onOpenUsage={() => {}} />);
    expect(host.querySelector(".aLineT5")).toBeNull();
    reply = rateLimited;
    await act(async () => button(host, "Check every account now").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const [stale, fresh] = [...host.querySelectorAll(".acctT5")];
    expect(stale.classList.contains("staleT5")).toBe(true);
    expect(stale.querySelector(".aLeftT5")?.textContent).toMatch(/^80% left · resets /);
    expect(stale.querySelector(".meterT5 i")?.getAttribute("style")).toBe("width: 20%;");
    expect(stale.querySelector(".aLineT5")?.textContent).toBe("Rate limited · last reading 12 min ago. Branch checks again in 5 min.");
    expect(fresh.classList.contains("staleT5")).toBe(false);
    expect(fresh.querySelector(".aLeftT5")?.textContent).toMatch(/^45% left · resets /);
    expect(fresh.querySelector(".aLineT5")).toBeNull();
    expect(fresh.textContent).not.toContain("last reading");
  });
  it("Usage: a long account label, the used-next badge and the reading each stay whole and wrap instead of clipping", async () => {
    const usage = { updatedAt: Date.now(), providers: [{ provider: "anthropic", displayName: "Claude", accountEmail: "a.very.long.claude.address@example-company.com", inUse: true, plan: "Max (20x)", windows: [{ label: "5h", usedPercent: 20, resetAt: Date.now() + 2 * 3_600_000 }] }] };
    const host = await show(<UsagePopover above={above} onClose={() => {}} limits={readLimits(usage)} request={vi.fn(async () => usage) as never} onOpenUsage={() => {}} />);
    const row = host.querySelector(".acctT5") as HTMLElement;
    expect(row.querySelector(":scope > .aNameT5 > .aLabelT5")?.textContent).toBe("a.very.long.claude.address@example-company.com");
    expect(row.querySelector(":scope > .pill.ok")?.textContent).toBe("used next");
    expect(row.querySelector(":scope > .aLeftT5")?.textContent).toMatch(/^80% left · resets /);
    const css = readFileSync(join(process.cwd(), "src/shell/status.css"), "utf8");
    const rule = (selector: string) => new RegExp(`(^|\\n)${selector.replace(/[.*]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[2] ?? "";
    // The account list's single column may never grow past the popover to fit a long label.
    expect(rule(".usePopT5 .lims")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".acctT5")).toContain("flex-wrap: wrap");
    expect(rule(".aNameT5")).not.toMatch(/overflow: hidden|white-space: nowrap/);
    expect(rule(".aLabelT5")).toContain("overflow-wrap: anywhere");
    expect(rule(".acctT5 > .pill")).toContain("flex: none");
    expect(rule(".aLeftT5")).toContain("flex: none");
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
