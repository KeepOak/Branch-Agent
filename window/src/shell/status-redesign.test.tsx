// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BRANCH_VERSION_TIP } from "../connect/branch-version";
import { StatusBar, UsageRing, usageRingColour, usageRingDash, type StatusItem } from "./StatusBar";
import { GatewayPopover, RunningPopover, UsagePopover, VersionPopover } from "./StatusPopovers";
import { machineMenuItems } from "./MachineMenu";
import { saveTargetName } from "../setup/pre-connect-state";
import { readLimits, ringReading } from "./status-data";
import { pauseAll, prepareBackground } from "./StatusLayer";
import { loadDraft, safeStorage } from "../composer/drafts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}
const above = { left: 10, right: 220, top: 700, align: "left" as const };
const click = async (host: HTMLElement, testid: string) => act(async () => host.querySelector<HTMLButtonElement>(`[data-testid=${testid}]`)!.click());
const seeded = readLimits({ updatedAt: Date.now(), providers: [
  { provider: "openai-codex", displayName: "ChatGPT", accountEmail: "you@example.com", plan: "Plus", windows: [{ label: "5h", usedPercent: 23, resetAt: Date.now() + 60_000 }, { label: "Week", usedPercent: 41 }] },
  { provider: "anthropic", displayName: "Claude", accountEmail: "work@example.com", plan: "Max", windows: [{ label: "5h", usedPercent: 48 }] },
] });

it("status glyphs open all six popovers from live facts", async () => {
  const onItem = vi.fn<(item: StatusItem) => void>();
  const host = await show(<StatusBar connection="connected" gateway="on" machineName="Studio Mac" roomUsed={0.14} running={3} version="0.19.5" readyVersion="0.20.0" usage={ringReading(seeded)} open={null} onItem={onItem} />);
  for (const [testid, item] of [["sb-connection", "connection"], ["sb-gateway", "gateway"], ["sb-room", "room"], ["sb-running", "running"], ["sb-usage", "usage"], ["sb-version", "version"]] as const) {
    await click(host, testid);
    expect(onItem).toHaveBeenLastCalledWith(item, expect.anything());
  }
  expect(host.querySelector("[data-testid=sb-connection]")?.getAttribute("aria-label")).toBe("Studio Mac · Online");
  expect(host.querySelector("[data-testid=sb-room]")?.getAttribute("aria-label")).toContain("Context: 86% left.");
  expect(host.querySelector("[data-testid=sb-room] .status-label")?.textContent).toBe("Context");
  expect(host.querySelector("[data-testid=sb-room] .status-number")?.textContent).toBe("86% left");
  expect(host.querySelector<HTMLElement>("[data-testid=sb-room] .ctx-meter-fill")?.style.width).toBe("86%");
  expect(host.querySelector("[data-testid=sb-running]")?.getAttribute("aria-label")).toBe("3 running");
  expect(host.querySelector("[data-testid=sb-version]")?.textContent).toContain("Branch 0.19.5");
  expect(host.querySelector("[data-testid=sb-version]")?.getAttribute("title")).toBe(BRANCH_VERSION_TIP);
  expect(host.querySelector("[data-testid=sb-usage]")?.getAttribute("aria-label")).toContain("ChatGPT · Account 1 · 77% left");
});

it("usage ring matches the preview 16px geometry and colour thresholds", async () => {
  expect(usageRingDash(60)).toBe("22.6 40");
  expect(usageRingDash(0)).toBe("0.0 40");
  expect(usageRingDash(100)).toBe("37.7 40");
  expect(usageRingColour(14)).toBe("var(--bad)");
  expect(usageRingColour(15)).toBe("var(--warn)");
  expect(usageRingColour(34)).toBe("var(--warn)");
  expect(usageRingColour(35)).toBe("var(--ok)");
  const host = await show(<UsageRing left={77} />);
  const svg = host.querySelector("svg")!;
  expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
  const circles = [...host.querySelectorAll("circle")];
  expect(circles[0]?.getAttribute("r")).toBe("6");
  expect(circles[1]?.getAttribute("stroke-width")).toBe("2");
  expect(circles[1]?.getAttribute("stroke-dasharray")).toBe(usageRingDash(77));
  expect(circles[1]?.getAttribute("stroke")).toBe("var(--ok)");
  await act(async () => root?.render(<UsageRing left={14} />));
  expect(host.querySelectorAll("circle")[1]?.getAttribute("stroke")).toBe("var(--bad)");
});

it("usage ring folds after five seconds; collapsed click expands, expanded click opens, Enter opens", async () => {
  vi.useFakeTimers();
  try {
    const onItem = vi.fn();
    const host = await show(<StatusBar connection="connected" gateway="on" machineName="This computer" roomUsed={null} running={0} version="0.19.5" usage={null} open={null} onItem={onItem} />);
    const ring = host.querySelector<HTMLButtonElement>("[data-testid=sb-usage]")!;
    expect(ring.getAttribute("aria-label")).toContain("no account limits yet");
    expect(ring.getAttribute("aria-label")).toContain("Enter opens every account");
    let hovered = true;
    vi.spyOn(ring, "matches").mockImplementation((selector) => selector === ":hover" && hovered);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(ring.classList.contains("collapsedT5")).toBe(false);
    hovered = false;
    await act(async () => vi.advanceTimersByTime(5000));
    expect(ring.classList.contains("collapsedT5")).toBe(true);
    await act(async () => ring.click());
    expect(onItem).not.toHaveBeenCalled();
    expect(ring.classList.contains("collapsedT5")).toBe(false);
    await act(async () => ring.click());
    expect(onItem).toHaveBeenCalledWith("usage", expect.anything());
    onItem.mockClear();
    hovered = false;
    await act(async () => vi.advanceTimersByTime(5000));
    expect(ring.classList.contains("collapsedT5")).toBe(true);
    await act(async () => ring.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onItem).toHaveBeenCalledWith("usage", expect.anything());
    expect(ring.classList.contains("collapsedT5")).toBe(false);
  } finally { vi.useRealTimers(); }
});

it("computer popover lists saved computers but not linked teammates", () => {
  const openSettings = vi.fn();
  const onLinkBranch = vi.fn(), onSwitch = vi.fn();
  const elsewhere = vi.fn();
  window.addEventListener("branch:connect-elsewhere", elsewhere, { once: true });
  localStorage.clear();
  saveTargetName("wss://other.example.test", "Other computer");
  const rows = machineMenuItems({ machineName: "Studio Mac", currentUrl: "ws://127.0.0.1:19031", homeUrl: "ws://127.0.0.1:19031", online: true, level: "regular", roundTripMs: 4, openSettings, onLinkBranch, onSwitch });
  expect(rows.find((row) => "label" in row && row.label === "Studio Mac")).toMatchObject({ sub: "Online · here", checked: true });
  expect(rows.find((row) => "label" in row && row.label === "Other computer")).toMatchObject({ sub: "Saved computer" });
  expect(rows.find((row) => "label" in row && row.label === "teammate.example.test")).toBeUndefined();
  expect(rows.some((row) => "label" in row && row.label === "Workspace")).toBe(false);
  for (const row of rows) if ("run" in row && row.run) row.run();
  expect(openSettings).toHaveBeenCalledWith("computer");
  expect(openSettings).toHaveBeenCalledWith("gateway");
  expect(elsewhere).toHaveBeenCalledOnce();
  expect(onLinkBranch).toHaveBeenCalledOnce();
  expect(onSwitch).toHaveBeenCalledWith("wss://other.example.test");
});

it("Every account is a flat list with preview row text and checks again through usage.status", async () => {
  const request = vi.fn(async (method: string) => method === "usage.status" ? { updatedAt: Date.now(), providers: [
    { provider: "openai-codex", displayName: "ChatGPT", accountEmail: "you@example.com", plan: "Plus", windows: [{ label: "5h", usedPercent: 23 }, { label: "Week", usedPercent: 41 }] },
    { provider: "anthropic", displayName: "Claude", accountEmail: "new@example.com", plan: "Pro", windows: [{ label: "5h", usedPercent: 9 }] },
  ] } : {});
  const open = vi.fn();
  const host = await show(<UsagePopover above={above} onClose={() => {}} limits={seeded} request={request as never} onOpenUsage={open} />);
  expect(request).toHaveBeenCalledWith("usage.status", { refresh: true });
  expect(host.querySelector(".sp-provider")).toBeNull();
  expect(host.textContent).toContain("you@example.com");
  expect(host.textContent).toContain("77% left");
  expect(host.textContent).toContain("ChatGPT · Account 1 · Plus · this week 41% used");
  expect(host.textContent).not.toContain("week 59% left");
  await click(host, "usage-check");
  expect(request).toHaveBeenCalledWith("models.authStatus", { refresh: true });
  expect(request.mock.calls.filter(([method]) => method === "usage.status")).toHaveLength(2);
  expect(host.textContent).toContain("new@example.com");
  expect(host.textContent).toContain("Claude · Account 1 · Pro");
  await click(host, "open-usage");
  expect(open).toHaveBeenCalledOnce();
});

it("Gateway, Running, and Update actions use their live callbacks", async () => {
  const restart = vi.fn(), settings = vi.fn();
  let host = await show(<GatewayPopover above={above} onClose={() => {}} level="regular" facts={{ health: { ok: true, durationMs: 4, checkedAt: Date.now() }, error: null, uptimeMs: 3_600_000, connectedAt: Date.now() }} onRestart={restart} onSettings={settings} />);
  expect(host.textContent).toContain("answered in 4 ms");
  await click(host, "gw-restart");
  await click(host, "gw-settings");
  expect(restart).toHaveBeenCalledOnce();
  expect(settings).toHaveBeenCalledOnce();
  await act(async () => root?.unmount()); root = undefined;
  const open = vi.fn(), automations = vi.fn();
  host = await show(<RunningPopover above={above} onClose={() => {}} request={vi.fn(async () => ({ jobs: [{ name: "Nightly check", enabled: true, state: { nextRunAtMs: Date.now() + 60_000 } }] })) as never} working={[{ key: "live", title: "Scout", line: "Reading", runIds: ["run-1"] }]} onOpen={open} onAutomations={automations} onBackground={() => {}} onPauseAll={() => {}} />);
  expect(host.textContent?.indexOf("Nightly check")).toBeLessThan(host.textContent!.indexOf("Scout"));
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Scout"))!.click());
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Open Automations"))!.click());
  expect(open).toHaveBeenCalledWith("live");
  expect(automations).toHaveBeenCalledOnce();
  await act(async () => root?.unmount()); root = undefined;
  const install = vi.fn(), whatsNew = vi.fn(), remind = vi.fn();
  host = await show(<VersionPopover above={above} onClose={() => {}} update={{ current: "0.19.5", latest: "0.20.0", notes: ["Groups can have rules"], installing: false, waiting: null }} version="0.19.5" desktopInstall onWhatsNew={whatsNew} onInstall={install} onRemind={remind} />);
  expect(host.textContent).toContain("You have 0.19.5");
  await click(host, "ver-install"); await click(host, "ver-whatsnew"); await click(host, "ver-remind");
  expect(install).toHaveBeenCalledOnce(); expect(whatsNew).toHaveBeenCalledOnce(); expect(remind).toHaveBeenCalledOnce();
});

it("Pause all Trunks aborts each live run and refreshes the list", async () => {
  const request = vi.fn(async () => ({}));
  const refresh = vi.fn(async () => {});
  await pauseAll({ session: { request } as never, list: { refresh } as never, working: [
    { key: "agent:a:main", title: "A", line: "Working", runIds: ["run-a", "run-b"] },
    { key: "agent:b:main", title: "B", line: "Working", runIds: ["run-c"] },
  ] });
  expect(request).toHaveBeenCalledTimes(3);
  expect(request).toHaveBeenCalledWith("chat.abort", { sessionKey: "agent:a:main", runId: "run-a" });
  expect(request).toHaveBeenCalledWith("chat.abort", { sessionKey: "agent:a:main", runId: "run-b" });
  expect(request).toHaveBeenCalledWith("chat.abort", { sessionKey: "agent:b:main", runId: "run-c" });
  expect(refresh).toHaveBeenCalledOnce();
});

it("Start something in the background opens the composer with /bg", () => {
  const openConversation = vi.fn();
  const compose = vi.fn();
  window.addEventListener("branch:compose", compose, { once: true });
  prepareBackground({ session: { getSnapshot: () => ({ mainKey: "agent:a:main" }) } as never, openRow: null, openConversation });
  expect(loadDraft(safeStorage(), "agent:a:main")).toBe("/bg ");
  expect(compose).toHaveBeenCalledOnce();
  expect(openConversation).toHaveBeenCalledWith("agent:a:main");
});
