// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";
import { findings, parseDotenv } from "./secrets";
import { campaignLine } from "./updates";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a === undefined) return {};
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function show(page: string, engine: WindowEngine, level: "regular" | "advanced" | "technical" = "regular") {
  await act(async () => root.render(<SettingsPage page={page} title={page} level={level} engine={engine} />));
  await flush();
}
function button(text: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}
async function click(text: string) { await act(async () => button(text).click()); await flush(); }

const READY = { sentinel: null, updateAvailable: { currentVersion: "1.0.0", latestVersion: "1.1.0", channel: "stable" }, effectiveChannel: "stable", schedule: { channel: "stable", autoEnabled: false } };
const RUNNING = { sessions: [{ key: "agent:main:a", agentId: "main", hasActiveRun: true, activeRunIds: ["r1"] }, { key: "agent:main:b", agentId: "main", hasActiveRun: false }] };

describe("Settings › Updates & about", () => {
  it("keeps build detail out of failed update copy", async () => {
    const { engine } = engineWith({ "update.status": { ...READY, lastRun: { status: "failed", reason: "Install stopped.", updatedAtMs: Date.now() } } });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "1.2.3-build-abcd1234" })));
    await show("updates", engine);
    expect(document.body.textContent).toContain("Branch 1.2.3 keeps running.");
    expect(document.body.textContent).not.toContain("build abcd1234 keeps running");
  });
  it("describes the last installation without the engine version", async () => {
    const { engine } = engineWith({ "update.status": { ...READY, lastRun: { status: "succeeded", updatedAtMs: Date.now(), after: { version: "2026.9.8" } } } });
    await show("updates", engine);
    const undo = document.querySelector('[data-row="Undo the last update"]');
    expect(undo?.textContent).toContain("Branch update installed");
    expect(undo?.textContent).not.toContain("2026.9.8");
  });
  it("keeps the engine version out of the Branch Updates heading", async () => {
    const { engine } = engineWith({ "update.status": READY, status: { runtimeVersion: "1.0.0" }, "system.info": { platform: "win32" } });
    await show("updates", engine);
    expect(document.body.textContent).not.toContain("Branch Agent 1.0.0 on Windows.");
    expect(document.body.textContent).toContain("Checking Branch’s version");
    expect(document.body.textContent).toContain("A Branch update is ready");
    expect(document.body.textContent).not.toContain("1.1.0");
  });
  it("says it is up to date when the engine reports no update", async () => {
    const { engine } = engineWith({ "update.status": { ...READY, updateAvailable: null }, status: { runtimeVersion: "1.0.0" } });
    await show("updates", engine);
    expect(document.body.textContent).toContain("Branch is up to date.");
    expect(document.body.textContent).not.toContain("Install when idle");
  });
  it("installs without a dialog or stopping running work", async () => {
    const { engine, request } = engineWith({ "update.status": READY, "sessions.list": RUNNING, "update.run": { ok: true, result: { status: "ok" } } });
    await show("updates", engine);
    await click("Install update");
    expect(document.body.textContent).not.toContain("Install 1.1.0");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(request.mock.calls.map(([m]) => m)).toContain("update.run");
    expect(request.mock.calls.map(([m]) => m)).not.toContain("sessions.abort");
    expect(document.body.textContent).toContain("Installing. You can keep working.");
  });
  it("shows the engine's refusal instead of claiming it installs", async () => {
    const { engine } = engineWith({ "update.status": READY, "sessions.list": { sessions: [] }, "update.run": { ok: false, message: "Updates are managed by the package manager." } });
    await show("updates", engine);
    await click("Install update");
    expect(document.body.textContent).toContain("Updates are managed by the package manager.");
  });
  it("saves the channel and the by-itself switch through config.patch", async () => {
    const { engine, request } = engineWith({ "update.status": READY, "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true, hash: "h2", config: { update: { channel: "beta" } } } });
    await show("updates", engine);
    await click("Beta");
    const patch = request.mock.calls.find(([m]) => m === "config.patch");
    expect(JSON.parse(String((patch?.[1] as { raw: string }).raw))).toEqual({ update: { channel: "beta" } });
  });
  it("greys what the engine can't do yet, without the developer note", async () => {
    const { engine } = engineWith({ "update.status": READY });
    await show("updates", engine);
    expect(button("Skip this version").disabled).toBe(true);
    const undo = document.querySelector('[data-row="Undo the last update"]');
    expect(undo?.getAttribute("aria-disabled")).toBe("true");
    expect(undo?.textContent).not.toContain("needs the engine");
  });
});

const PAIRS = {
  "device.pair.list": { pending: [{ requestId: "r1", deviceId: "d1", publicKey: "k", displayName: "Studio laptop", platform: "win32", scopes: ["operator.admin"], ts: Date.now() }], paired: [] },
  "node.pair.list": { pending: [{ requestId: "n1", nodeId: "node-a", displayName: "Desk Mac", platform: "darwin", commands: ["camera.snap"], ts: Date.now() }], paired: [{ nodeId: "node-a" }] },
  "node.list": { nodes: [{ nodeId: "node-a", displayName: "Desk Mac", platform: "darwin", connected: true, approvalState: "approved", workerSlots: { total: 4, available: 3 } }] },
  "agents.list": { agents: [{ id: "main", identity: { name: "Sapling" } }] },
};

describe("Settings › Computer & browser", () => {
  it("lists requests from both pairing stores in plain words", async () => {
    const { engine } = engineWith(PAIRS);
    await show("computer", engine);
    expect(document.body.textContent).toContain("Studio laptop wants to connect");
    expect(document.body.textContent).toContain("Change Branch’s settings");
    expect(document.body.textContent).toContain("Desk Mac asks to do more");
    expect(document.body.textContent).toContain("Asks for more access than before");
  });
  it("Allow waits a moment, then approves through the matching store", async () => {
    vi.useFakeTimers();
    try {
      const { engine, request } = engineWith(PAIRS);
      await show("computer", engine);
      const allow = () => document.querySelector<HTMLButtonElement>('[data-row="Desk Mac"].s2-req button.pri')!;
      expect(allow().disabled).toBe(true);
      await act(async () => { vi.advanceTimersByTime(1600); });
      expect(allow().disabled).toBe(false);
      await act(async () => allow().click());
      await flush();
      expect(request).toHaveBeenCalledWith("node.pair.approve", { requestId: "n1" });
    } finally { vi.useRealTimers(); }
  });
  it("Don't allow asks first, then rejects", async () => {
    const { engine, request } = engineWith(PAIRS);
    await show("computer", engine);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-row="Studio laptop"].s2-req button')!.click());
    expect(document.body.textContent).toContain("Studio laptop has to ask again before it can connect.");
    expect(request).not.toHaveBeenCalledWith("device.pair.reject", expect.anything());
    await click("Turn it down");
    expect(request).toHaveBeenCalledWith("device.pair.reject", { requestId: "r1" });
  });
  it("draws paired computers with Ready, the busy meter and a rename on node.rename", async () => {
    const { engine, request } = engineWith(PAIRS);
    await show("computer", engine);
    const card = document.querySelector('[data-row="Desk Mac"].s2-comp');
    expect(card?.textContent).toContain("Ready");
    expect(card?.textContent).toContain("1 of 4 busy");
    await act(async () => (card!.querySelector('[aria-label="More for Desk Mac"]') as HTMLButtonElement).click());
    await click("Rename…");
    const input = document.querySelector(".dlg input") as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, "Studio Mac"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Rename");
    expect(request).toHaveBeenCalledWith("node.rename", { nodeId: "node-a", displayName: "Studio Mac" });
  });
});

const STORE = { entries: [
  { name: "OPENAI_API_KEY", kind: "secret", scopeKind: "team", scopeId: "", createdAtMs: 1, updatedAtMs: Date.now(), allowedHosts: ["api.openai.com"] },
  { name: "HOME_URL", kind: "env", value: "http://home.local", scopeKind: "team", scopeId: "", createdAtMs: 1, updatedAtMs: Date.now() },
] };
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Settings › Saved sign-ins", () => {
  it("lists the key store: protected keys hidden, readable ones shown", async () => {
    const { engine } = engineWith({ "secrets.store.list": STORE, "config.get": { hash: "h", valid: true, config: {} } });
    await show("secrets", engine, "advanced");
    const prot = document.querySelector('[data-row="OPENAI_API_KEY"]')!;
    expect(prot.textContent).toContain("Protected");
    expect(prot.textContent).toContain("••••••••");
    expect(prot.textContent).toContain("Sites: api.openai.com");
    expect(document.querySelector('[data-row="HOME_URL"]')!.textContent).toContain("Trunks can read it");
    expect(document.body.textContent).toContain("No password manager is connected");
  });
  it("Add a key saves a protected key with its sites through secrets.store.set", async () => {
    const { engine, request } = engineWith({ "secrets.store.list": STORE, "config.get": { hash: "h", valid: true, config: {} }, "secrets.store.set": { ok: true, reloaded: true } });
    await show("secrets", engine, "advanced");
    await click("Add a key");
    const [name] = document.querySelectorAll<HTMLInputElement>(".dlg input.inp");
    const [value, sites] = document.querySelectorAll<HTMLTextAreaElement>(".dlg textarea");
    await act(async () => { type(name, "brave_key"); type(value, "abc"); type(sites, "api.search.brave.com, x.example"); });
    await click("Save");
    expect(request).toHaveBeenCalledWith("secrets.store.set", { name: "BRAVE_KEY", value: "abc", kind: "secret", allowedHosts: ["api.search.brave.com", "x.example"] });
  });
  it("reads .env lines and finds plain-text keys and dangling pointers", () => {
    expect(parseDotenv(["# c", 'export A_TOKEN="x y"', "bad line", "B=2"].join(String.fromCharCode(10)))).toEqual([{ name: "A_TOKEN", value: "x y" }, { name: "B", value: "2" }]);
    const found = findings({ channels: { t: { botToken: "__BRANCH_REDACTED__" } }, tools: { k: { source: "store", provider: "default", id: "GONE" }, ok: { source: "store", provider: "default", id: "HERE" } } }, new Set(["HERE"]));
    expect(found).toEqual([{ what: "Written in plain text", path: "channels.t.botToken" }, { what: "Points to nothing", path: "tools.k", note: "GONE" }]);
  });
});

const RINGS_STATUS = { agentId: "main", embedding: { ok: true }, rings: { enabled: true, shortTermCount: 9, promotedToday: 2, promotedTotal: 3, shortTermEntries: [], signalEntries: [], promotedEntries: [], phases: { light: { enabled: true }, deep: { enabled: true, limit: 10 }, rem: { enabled: true } } } };

describe("Settings › Seasons", () => {
  it("reads Rings from the memory engine and saves the night window as its cron", async () => {
    const { engine, request } = engineWith({ "doctor.memory.status": RINGS_STATUS, "skills.proposals.list": { proposals: [] }, "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true, hash: "h2", config: {} } });
    await show("seasons", engine);
    expect(document.body.textContent).toContain("This season: 3 changes kept");
    await click("1 AM");
    const patch = request.mock.calls.find(([m]) => m === "config.patch");
    expect(JSON.parse(String((patch?.[1] as { raw: string }).raw))).toEqual({ plugins: { entries: { "memory-core": { config: { rings: { frequency: "0 1 * * *" } } } } } });
  });
  it("turns Budding on as the skill workshop proposing, never installing by itself", async () => {
    const { engine, request } = engineWith({ "doctor.memory.status": RINGS_STATUS, "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true, hash: "h2", config: {} } });
    await show("seasons", engine);
    await act(async () => (document.querySelector('[aria-label="Learn what a Trunk can’t do yet"]') as HTMLInputElement).click());
    await flush();
    const patch = request.mock.calls.find(([m]) => m === "config.patch");
    expect(JSON.parse(String((patch?.[1] as { raw: string }).raw))).toEqual({ skills: { workshop: { autonomous: { mode: "propose" } } } });
  });
  it("runs maintenance on doctor.memory and reports what it did", async () => {
    const { engine, request } = engineWith({ "doctor.memory.status": RINGS_STATUS, "doctor.memory.dedupeDreamDiary": { removedEntries: 4 } });
    await show("seasons", engine, "technical");
    await click("Remove repeats");
    expect(request).toHaveBeenCalledWith("doctor.memory.dedupeDreamDiary", { agentId: "main" });
    expect(document.body.textContent).toContain("Removed 4 repeats.");
  });
  it("Look at skills now runs the skill collection review and shows its outcome", async () => {
    const review = { id: "r1", name: "skill-collection-review-main", displayName: "Skill collection review (main)", enabled: true, state: {} };
    let entries: unknown[] = [];
    const { engine, request } = engineWith({ "doctor.memory.status": RINGS_STATUS, "cron.list": { jobs: [review], hasMore: false }, "cron.run": { ok: true, enqueued: true, runId: "run1" }, "cron.runs": () => ({ entries }) });
    let emit: (e: { event: string }) => void = () => {};
    engine.onEvent = ((fn: (e: { event: string }) => void) => { emit = fn; return () => {}; }) as WindowEngine["onEvent"];
    await show("seasons", engine);
    expect(request).toHaveBeenCalledWith("cron.list", { includeDisabled: true, agentId: "main", limit: 200 });
    await click("Look now");
    expect(request).toHaveBeenCalledWith("cron.run", { id: "r1", mode: "force" });
    expect(document.body.textContent).toContain("Looking at skills now.");
    expect(button("Looking…").disabled).toBe(true);
    entries = [{ ts: Date.now(), jobId: "r1", action: "finished", status: "ok", runId: "run1", summary: "Merged two release skills into one." }];
    await act(async () => emit({ event: "cron" }));
    await flush();
    expect(document.body.textContent).toContain("Last look today");
    expect(document.body.textContent).toContain("it finished.");
    await click("What it did");
    expect(document.querySelector(".dlg")?.textContent).toContain("Merged two release skills into one.");
  });
  it("greys Look now with the review's reason and no longer shows the retired skill resting rows", async () => {
    const { engine, request } = engineWith({ "doctor.memory.status": RINGS_STATUS, "cron.list": { jobs: [{ id: "r1", name: "skill-collection-review-main", enabled: false, state: {} }], hasMore: false } });
    await show("seasons", engine, "technical");
    expect(document.body.textContent).toContain("Reviews run only while skill learning may change skills by itself.");
    await click("Look now");
    expect(request).not.toHaveBeenCalledWith("cron.run", expect.anything());
    for (const gone of ["Look after skills", "Rest a skill after", "Set it aside after", "Gardener", "retired"]) expect(document.body.textContent).not.toContain(gone);
  });
});

describe("Settings › Gateway", () => {
  const H = { ok: true, ts: Date.now(), durationMs: 3, channels: { telegram: { connected: true } }, channelLabels: { telegram: "Telegram" } };
  it("keeps the close-window control below Gateway mode and saves through the desktop setting", async () => {
    let state = { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: false, startWithWindows: false, branchOnPath: false };
    const set = vi.fn(async (name: keyof typeof state, on: boolean) => (state = { ...state, [name]: on }));
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    try {
      const { engine } = engineWith({ health: H });
      await show("gateway", engine);
      const mode = document.querySelector('[data-row="Gateway"]');
      const row = document.querySelector('[data-row="Keep working when the window closes"]');
      expect(mode?.nextElementSibling).toBe(row);
      const control = row?.querySelector<HTMLInputElement>('input[role="switch"]');
      expect(control?.checked).toBe(true);
      await act(async () => control?.click());
      expect(set).toHaveBeenCalledWith("keepWorking", false);
      expect(control?.checked).toBe(false);
    } finally {
      delete (window as { branchDesktop?: unknown }).branchDesktop;
    }
  });
  it("says the gateway is on from health and system.info, and restarts it on gateway.restart.request", async () => {
    const { engine, request } = engineWith({ health: H, "system.info": { uptimeMs: 3 * 86_400_000 }, "gateway.restart.request": { ok: true, status: "scheduled" } });
    await show("gateway", engine);
    expect(document.body.textContent).toContain("On. Up 3 days. Telegram keeps working when the window is closed.");
    await click("Restart the engine");
    expect(request).toHaveBeenCalledWith("gateway.restart.request", { reason: "settings" });
    expect(document.body.textContent).toContain("Restarting. The window reconnects by itself.");
  });
  it("says so when the gateway doesn't answer", async () => {
    const { engine, request } = engineWith({});
    request.mockImplementation(async (m: string) => { if (m === "health") throw new Error("socket closed"); return {}; });
    await show("gateway", engine);
    expect(document.body.textContent).toContain("The gateway isn’t answering");
  });
  it("saves who can reach it as gateway.bind", async () => {
    const { engine, request } = engineWith({ health: H, "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true, hash: "h2", config: {} } });
    await show("gateway", engine, "advanced");
    await click("My network");
    const patch = request.mock.calls.find(([m]) => m === "config.patch");
    expect(JSON.parse(String((patch?.[1] as { raw: string }).raw))).toEqual({ gateway: { bind: "lan" } });
  });
});

describe("Settings › Branch itself", () => {
  it("lists every change from branch.changes.list and greys roll back with its reason", async () => {
    const { engine } = engineWith({ health: { ok: true }, "branch.changes.list": { entries: [{ id: "c1", at: Date.now(), kind: "config-write", source: "config-rpc", summary: "Updated update.channel", changedPaths: ["update.channel"] }] } });
    await show("self", engine);
    expect(document.body.textContent).toContain("Settings: Updated update.channel");
    expect(button("Roll back").disabled).toBe(true);
  });
  it("tidies conversation storage on sessions.storage.run only when archiving is on", async () => {
    const storage = { agents: [{ agentId: "main", storePath: "s", hotTranscripts: 5, coldTranscripts: 1, databaseBytes: 1, walBytes: 0, archiveBytes: 0, embeddedArchiveBytes: 0 }], maintenance: { running: false, lastStartedAt: null, lastCompletedAt: null, lastError: null, archivedTranscripts: 0, externalizedTranscripts: 0 } };
    const { engine, request } = engineWith({ "sessions.storage.status": storage, "config.get": { hash: "h", valid: true, config: { session: { maintenance: { coldStorage: { enabled: true } } } } }, "sessions.storage.run": { ok: true } });
    await show("self", engine, "advanced");
    expect(document.body.textContent).toContain("5 ready · 1 archived");
    await click("Run now");
    expect(request).toHaveBeenCalledWith("sessions.storage.run", {});
  });
  it("keeps the Install updates setting in Updates & about only", async () => {
    const { engine } = engineWith({ health: { ok: true }, "config.get": { hash: "h", valid: true, config: {} } });
    await show("self", engine);
    expect(document.querySelector('[aria-label="Updating itself"]')).toBeNull();
  });
});

describe("Settings › Updates & about, an update the engine started", () => {
  it("words each campaign state as the preview does", () => {
    const now = 1_000_000;
    expect(campaignLine({ state: "waiting-for-idle", forceAtMs: now + 5 * 60_000 }, now)).toBe("Waiting for running tasks · updates anyway in 5 min");
    expect(campaignLine({ state: "countdown", applyAtMs: now + 42_000 }, now)).toBe("Updating in 0:42");
    expect(campaignLine({ state: "countdown", applyAtMs: now + 42_000, holdUntilMs: now + 3_600_000 }, now)).toBe("Held · resumes in 60 min");
    expect(campaignLine({ state: "applying" }, now)).toBe("Installing");
  });
  it("shows the countdown and holds it on update.hold", async () => {
    const at = Date.now();
    const campaign = { id: "c1", state: "countdown", announcedAtMs: at, applyAtMs: at + 50_000, forceAtMs: at + 300_000, updatedAtMs: at };
    const { engine, request } = engineWith({ "update.status": { ...READY, schedule: { channel: "stable", autoEnabled: true, campaign } }, "update.hold": { ok: true, schedule: { channel: "stable", autoEnabled: true, campaign: { ...campaign, holdUntilMs: at + 3_600_000 } } } });
    await show("updates", engine);
    expect(document.body.textContent).toContain("A Branch update is installing by itself");
    expect(document.body.textContent).toMatch(/Updating in 0:\d\d/);
    await click("Hold for an hour");
    expect(request).toHaveBeenCalledWith("update.hold", {});
    expect(document.body.textContent).toContain("Held until");
  });
  it("says so when the engine won't hold it", async () => {
    const at = Date.now();
    const campaign = { id: "c1", state: "waiting-for-idle", announcedAtMs: at, forceAtMs: at + 300_000, updatedAtMs: at };
    const { engine } = engineWith({ "update.status": { ...READY, schedule: { channel: "stable", autoEnabled: true, campaign } }, "update.hold": { ok: false } });
    await show("updates", engine);
    await click("Hold for an hour");
    expect(document.body.textContent).toContain("The engine didn’t hold it");
  });
});
