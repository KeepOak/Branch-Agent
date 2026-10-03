// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OVERVIEW_READS, OverviewData, people, runs, sessions, sharedConnections } from "./engine";
import { OverviewPlace, LOCKDOWN_GAP, PAUSE_ALL_GAP } from "./index";
import { KEEP_RUNNING_GAP, resetRecommendation } from "./RecBar";
import { takeInboxHandoff } from "../inbox/handoff";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture(request: (method: string, params?: unknown) => Promise<unknown>) {
  let listener: ((event: { event: string; payload?: unknown }) => void) | undefined;
  const engine: WindowEngine = {
    request: request as WindowEngine["request"], sessionKey: null, scopes: ["operator.admin"],
    onEvent: vi.fn(callback => { listener = callback; return () => { listener = undefined; }; }),
  };
  return { engine, emit: (event: string, payload?: unknown) => listener?.({ event, payload }) };
}

const NOW = Date.now();
const FX: Record<string, unknown> = {
  "sessions.list": { sessions: [
    { key: "agent:main:a", agentId: "main", label: "Sort the receipts", hasActiveRun: true, observerDigest: { headline: "Reading the folder" }, updatedAt: NOW, owner: { actor: { type: "human", id: "p1" } } },
    { key: "agent:main:b", agentId: "main", label: "Plan the week", updatedAt: NOW - 6e4, createdActor: { type: "human", id: "p1" } },
    { key: "agent:main:c", agentId: "main", label: "A helper", spawnedBy: "agent:main:a", updatedAt: NOW - 7e4, owner: { actor: { type: "human", id: "p1" } } },
  ] },
  health: { ok: true, channels: { tg: { name: "Telegram", connected: true } } },
  "system.info": { machineName: "Desk" },
  "sessions.usage": { totals: { totalCost: 1.7 }, aggregates: { byAgent: [{ agentId: "main", totals: { totalCost: 1.1 } }, { agentId: "helper", totals: { totalCost: 0.6 } }] } },
  "users.list": { profiles: [{ id: "p1", displayName: "Robin" }] },
  "system-presence": [{ user: { id: "p1" }, lastActivityAt: NOW - 1000, onlineSince: NOW - 30 * 6e4, platform: "Windows", timeZone: "Europe/Paris", watchedSessions: ["agent:main:b"] }, { roles: ["operator"], mode: "cli" }],
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Rowan" }, defaultPermissionMode: "guarded" }, { id: "helper", name: "Elm" }] },
  "backup.status": { targets: [{ latest: { status: "ok", createdAt: new Date(new Date(NOW).setHours(2, 0, 0, 0)).getTime() } }], schedules: [], locations: [] },
  "update.status": { sentinel: null, updateAvailable: { currentVersion: "1.0.0", latestVersion: "1.1.0", channel: "stable" } },
  "audit.list": { events: [
    { kind: "agent_run", action: "agent.run.started", runId: "r1", agentId: "main", sessionKey: "agent:main:b", occurredAt: 1000, status: "started" },
    { kind: "agent_run", action: "agent.run.finished", runId: "r1", agentId: "main", sessionKey: "agent:main:b", occurredAt: 73000, status: "succeeded" },
  ] },
};

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; resetRecommendation(); localStorage.clear(); });

async function render(request = vi.fn(async (method: string) => FX[method] ?? {})) {
  const openPlace = vi.fn(), openSettings = vi.fn(), openConversation = vi.fn();
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<OverviewPlace engine={fixture(request).engine} facts={{ running: 1, waiting: 2 }} openConversation={openConversation} openPlace={openPlace} openSettings={openSettings} level="regular" />));
  await act(async () => { await Promise.resolve(); });
  return { host, request, openPlace, openSettings, openConversation };
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === label);

describe("Overview reads", () => {
  it("reads each tile from its engine method, spend per Trunk from sessions.usage over seven days", () => {
    expect(OVERVIEW_READS.spend).toEqual({ method: "sessions.usage", params: { agentScope: "all", range: "7d", mode: "gateway", limit: 1 } });
    expect(OVERVIEW_READS.backup.method).toBe("backup.status");
    expect(OVERVIEW_READS.update.method).toBe("update.status");
    expect(OVERVIEW_READS.runs).toEqual({ method: "audit.list", params: { kind: "agent_run", limit: 500 } });
  });

  it("shows independent read failures without losing successful tiles, then recovers on retry", async () => {
    const request = vi.fn(async (method: string): Promise<unknown> => {
      if (method === "sessions.usage") throw new Error("Aggregate usage is forbidden");
      return method === "system.info" ? { machineName: "Desk" } : {};
    });
    const data = new OverviewData(fixture(request).engine);
    await data.refresh();
    expect(data.getSnapshot().tiles.spend.error).toContain("forbidden");
    expect(data.getSnapshot().tiles.computer.value).toEqual({ machineName: "Desk" });
    request.mockImplementation(async () => ({ totals: { totalCost: 0 } }));
    await data.refresh(["spend"]);
    expect(data.getSnapshot().tiles.spend.error).toBeUndefined();
  });

  it("coalesces repeat refreshes and reads again after a session event during a pending read", async () => {
    const first = deferred<unknown>();
    const request = vi.fn(async (method: string) => method === "sessions.list" ? first.promise : {});
    const f = fixture(request), data = new OverviewData(f.engine);
    data.start();
    const pending = data.refresh(["sessions"]);
    f.emit("sessions.changed");
    f.emit("sessions.changed");
    request.mockImplementation(async () => ({ sessions: [{ key: "new" }] }));
    first.resolve({ sessions: [{ key: "old" }] });
    await pending;
    await vi.waitFor(() => expect(sessions(data.getSnapshot().tiles.sessions.value)[0].key).toBe("new"));
    expect(request.mock.calls.filter(([m]) => m === "sessions.list")).toHaveLength(2);
    data.stop();
  });

  it("pairs audit start and finish events into runs and never infers presence from profiles", () => {
    expect(runs(FX["audit.list"])[0]).toMatchObject({ runId: "r1", startedAt: 1000, finishedAt: 73000, status: "succeeded" });
    const result = people({ profiles: [{ id: "a", displayName: "A" }, { id: "b" }, { id: "m", mergedInto: "a" }] }, [{ user: { id: "a" }, lastActivityAt: 200 }], 300);
    expect(result.map(p => [p.name, p.online, p.active])).toEqual([["A", true, true], ["b", false, false]]);
    expect(sharedConnections([{ roles: ["operator"] }, { mode: "gateway", reason: "self", roles: ["operator"] }, { user: { id: "a" }, roles: ["operator"] }])).toHaveLength(1);
  });
});

describe("Overview screen", () => {
  it("draws Health with Backup and Update from the engine, spend per Trunk, and run lengths", async () => {
    const { host } = await render();
    const text = host.textContent ?? "";
    expect(text).toContain("Telegram");
    expect(text).toContain("Last night,");
    expect(text).toContain("1.1.0 ready");
    expect(text).toContain("$1.70");
    expect([...host.querySelectorAll(".ov-brow")].map(r => r.textContent)).toEqual(["Rowan$1.10", "Elm$0.60"]);
    expect(text).toContain("1m 12s");
    expect(text).toContain("Mode: Ask first");
  });

  it("greys controls the engine cannot back, with their reasons", async () => {
    const { host } = await render();
    expect(button(host, "Lockdown")).toMatchObject({ disabled: true, title: LOCKDOWN_GAP });
    expect(button(host, "Pause all Trunks")).toMatchObject({ disabled: true, title: PAUSE_ALL_GAP });
    expect(button(host, "Yes")).toMatchObject({ disabled: true, title: KEEP_RUNNING_GAP });
  });

  it("hides the recommendation on Not now, and keeps it hidden after Don't ask again", async () => {
    const first = await render();
    await act(async () => button(first.host, "Not now")!.click());
    expect(first.host.textContent).not.toContain("Keep your Trunks running");
    await act(async () => root?.unmount()); root = undefined; resetRecommendation();
    const second = await render();
    await act(async () => button(second.host, "Don’t ask again")!.click());
    await act(async () => root?.unmount()); root = undefined; resetRecommendation();
    const third = await render();
    expect(third.host.textContent).not.toContain("Keep your Trunks running");
  });

  it("counts a person's open and running conversations without helpers, and adds the shared owner", async () => {
    const { host } = await render();
    const lines = [...host.querySelectorAll(".ov-pres")].map(l => l.textContent);
    expect(lines[0]).toBe("RRobin2 open · 1 running");
    expect(lines[1]).toContain("Shared owner");
  });

  it("opens the person card on focus and hands their filter to the Inbox", async () => {
    const { host, openPlace } = await render();
    await act(async () => (host.querySelector(".ov-pres") as HTMLElement).focus());
    const card = document.querySelector(".ov-pcard")!;
    expect(card.textContent).toContain("Online for 30 minutes");
    expect(card.textContent).toContain("Windows · Europe/Paris");
    expect(card.textContent).toContain("Plan the week");
    await act(async () => button(card as HTMLElement, "See their activity")!.click());
    expect(openPlace).toHaveBeenCalledWith("inbox");
    expect(takeInboxHandoff()).toEqual({ tab: "history", people: ["p1"] });
  });

  it("opens the Inbox on History from All history", async () => {
    const { host, openPlace } = await render();
    const heard = vi.fn();
    window.addEventListener("branch:place-tab", e => heard((e as CustomEvent).detail));
    await act(async () => { button(host, "All history")!.click(); await new Promise(r => setTimeout(r, 0)); });
    expect(openPlace).toHaveBeenCalledWith("inbox");
    expect(heard).toHaveBeenCalledWith({ place: "inbox", tab: "History" });
  });

  it("opens the permission settings from Mode · change", async () => {
    const { host, openSettings } = await render();
    await act(async () => button(host, "change")!.click());
    expect(openSettings).toHaveBeenCalledWith("permissions");
  });
});
