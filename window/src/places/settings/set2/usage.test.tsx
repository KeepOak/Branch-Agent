// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UsagePage, daysFrom, gbFrom, matches, parseQuery, resetWords, tidyNote } from "./usage";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    if (a === undefined) return {};
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine, level: "regular" | "advanced" | "technical" = "regular") {
  await act(async () => root.render(<UsagePage page="usage" title="Data & usage" level={level} engine={engine} />));
  await flush();
}
function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const b = [...scope.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); await flush(); }
const row = (title: string) => document.querySelector(`[data-row="${title}"]`);
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const patched = (request: ReturnType<typeof vi.fn>) => calls(request, "config.patch").map((p) => JSON.parse(String(p.raw)) as unknown);

const T = (cost: number, tokens = 1000) => ({ input: tokens / 2, output: tokens / 4, cacheRead: tokens / 8, cacheWrite: tokens / 8, totalTokens: tokens, totalCost: cost, inputCost: cost / 2, outputCost: cost / 2, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0 });
const USAGE = {
  startDate: "2026-09-04", endDate: "2026-10-03", totals: T(16.84, 4_700_000), cacheStatus: { status: "fresh" },
  creatorOptions: [{ key: "k-owner", actor: { type: "human", id: "owner", label: "Owner" } }],
  sessions: [
    { key: "agent:main:a", label: "Quarterly numbers", agentId: "main", updatedAt: 2, channel: "webchat", model: "gpt-5", usage: { ...T(2.36, 660_000), messageCounts: { total: 30, user: 10, assistant: 20, toolCalls: 4, toolResults: 4, errors: 2 } } },
    { key: "agent:helper:b", label: "Trip planning", agentId: "helper", updatedAt: 1, channel: "telegram", model: "claude-opus", usage: { ...T(0.5, 90_000), messageCounts: { total: 8, user: 3, assistant: 5, toolCalls: 0, toolResults: 0, errors: 0 } } },
  ],
  aggregates: {
    sessionCount: 2, messages: { total: 406, user: 164, assistant: 219, toolCalls: 690, toolResults: 690, errors: 60 }, tools: { totalCalls: 690, uniqueTools: 1, tools: [{ name: "web_search", count: 690 }] },
    byModel: [{ model: "gpt-5", count: 100, totals: T(9.92) }, { model: "qwen3", count: 10, totals: T(0) }], byProvider: [{ provider: "openai", count: 100, totals: T(9.92) }],
    byAgent: [{ agentId: "main", totals: T(1.1) }, { agentId: "helper", totals: T(0.42) }], byChannel: [{ channel: "webchat", totals: T(1, 520) }, { channel: "telegram", totals: T(1, 480) }],
    byCreator: [{ key: "k-owner", actor: { type: "human", label: "Owner" }, totals: T(16.84), sessionCount: 2, daily: [], sessionActivity: [] }],
    costDaily: [{ date: "2026-10-02", ...T(1, 2000) }, { date: "2026-10-03", ...T(2, 4000) }],
    daily: [{ date: "2026-10-02", tokens: 2000, cost: 1, messages: 10, toolCalls: 2, errors: 1 }, { date: "2026-10-03", tokens: 4000, cost: 2, messages: 10, toolCalls: 2, errors: 0 }],
  },
};
const STATUS = { updatedAt: Date.now() - 4 * 60_000, providers: [
  { provider: "anthropic", displayName: "Claude plan", plan: "Max", windows: [{ label: "This week", usedPercent: 42, resetAt: Date.now() + 3 * 86_400_000 }] },
  { provider: "google", displayName: "Google Gemini", windows: [] },
  { provider: "zai", displayName: "Z.ai", windows: [], error: "Token expired" },
] };
const BASE: Answers = { "sessions.usage": USAGE, "usage.status": STATUS, "agents.list": { agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "helper", name: "Helper" }] }, "usage.cost": { totals: T(14.2), daily: [] },
  "plugins.list": { plugins: [{ id: "codex", installed: true }, { id: "anthropic", installed: true }, { id: "opencode", installed: false }] } };
const CFG = (config: Record<string, unknown> = {}): Answers => ({ "config.get": { hash: "h", valid: true, config }, "config.patch": { ok: true, hash: "h2", config } });

describe("Settings › Data & usage", () => {
  it("draws the spend card from sessions.usage across every Trunk, in local days", async () => {
    const { engine, request } = engineWith(BASE);
    await show(engine);
    const card = document.querySelector(".s2usage-rep")!;
    expect(card.textContent).toContain("$16.84");
    expect(card.textContent).toContain("164 tasks · estimated from each model’s price");
    expect(calls(request, "sessions.usage")[0]).toMatchObject({ range: "30d", agentScope: "all", mode: "specific" });
    await click("7 days", card);
    expect(calls(request, "sessions.usage").some((p) => p.range === "7d" && p.limit === 1)).toBe(true);
  });
  it("shows the engine's error instead of a spend figure", async () => {
    const { engine } = engineWith({ ...BASE, "sessions.usage": new Error("Usage is hidden by your operator role") });
    await show(engine);
    expect(document.querySelector(".s2usage-rep")!.textContent).toContain("Usage is hidden by your operator role");
    expect(document.querySelector(".s2usage-rep")!.textContent).not.toContain("$");
  });
  it("lists each connection's allowance from usage.status, with its pill", async () => {
    const { engine } = engineWith(BASE);
    await show(engine);
    const claude = document.querySelector('[data-provider="anthropic"]')!;
    expect(claude.textContent).toContain("Measured");
    expect(claude.textContent).toContain("58% left · resets");
    expect(claude.textContent).toContain("as of 4 min ago, asked Claude plan");
    expect(document.querySelector('[data-provider="google"]')!.textContent).toContain("Not published");
    expect(document.querySelector('[data-provider="zai"]')!.textContent).toContain("Token expired");
  });
  it("draws spend per Trunk by name and this month's total", async () => {
    const { engine, request } = engineWith(BASE);
    await show(engine);
    const sec = document.querySelector('[data-sec="Spend, last 7 days"]')!;
    expect(sec.textContent).toContain("Sapling$1.10");
    expect(sec.textContent).toContain("Helper$0.42");
    expect(sec.textContent).toContain("This month: $14.20.");
    expect(calls(request, "usage.cost")[0]).toMatchObject({ agentScope: "all" });
  });
  it("greys what the engine can't do, with the reason", async () => {
    const { engine } = engineWith(BASE);
    await show(engine, "advanced");
    expect(row("Spend caps per service")?.getAttribute("aria-disabled")).toBe("true"); expect(row("Spend caps per service")?.textContent).not.toContain("Spend caps need the engine");
    expect(row("Keep conversations")?.getAttribute("aria-disabled")).toBeNull();
    expect(row("Reset Branch")?.textContent).not.toContain("no reset method");
    expect(button("Run the test").disabled).toBe(true);
  });
});

describe("the usage report", () => {
  it("opens with tiles and groups from sessions.usage", async () => {
    const { engine } = engineWith(BASE);
    await show(engine);
    await click("Open the report");
    const dlg = document.querySelector(".dlg")!;
    expect(dlg.querySelector("h2")?.textContent).toBe("Usage · last 30 days");
    expect(dlg.textContent).toContain("Spent$16.84");
    expect(dlg.textContent).toContain("Cheapest per taskqwen3 · free");
    expect(dlg.querySelector('[data-group="By model"]')?.textContent).toContain("gpt-5$9.92");
    expect(dlg.querySelector('[data-group="By where it came from"]')?.textContent).toContain("This window52%");
    expect(dlg.querySelector('[data-group="By person"]')?.textContent).toContain("Owner100%");
  });
  it("re-asks the engine for Today, a Trunk and a person", async () => {
    const { engine, request } = engineWith(BASE);
    await show(engine, "advanced");
    await click("Open the report");
    const dlg = document.querySelector(".dlg")!;
    await click("Today", dlg);
    const last = () => calls(request, "sessions.usage").at(-1)!;
    expect(last().startDate).toBe(last().endDate);
    const trunk = dlg.querySelector<HTMLSelectElement>('select[aria-label="Trunk"]')!;
    await act(async () => { trunk.value = "helper"; trunk.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    expect(last()).toMatchObject({ agentId: "helper" });
    expect(last().agentScope).toBeUndefined();
    const who = dlg.querySelector<HTMLSelectElement>('select[aria-label="Started by"]')!;
    await act(async () => { who.value = "k-owner"; who.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    expect(last()).toMatchObject({ creatorKey: "k-owner" });
    expect(dlg.querySelector<HTMLButtonElement>('button[title^="Splitting usage"]')?.disabled).toBe(true);
  });
  it("picks a day from the chart and asks for just that day", async () => {
    const { engine, request } = engineWith(BASE);
    await show(engine, "advanced");
    await click("Open the report");
    const bar = document.querySelector<HTMLButtonElement>('.s2usage-bar[aria-label^="Oct 3"]') ?? document.querySelectorAll<HTMLButtonElement>(".s2usage-bar")[29];
    await act(async () => bar.click()); await flush();
    expect(calls(request, "sessions.usage").at(-1)).toMatchObject({ startDate: "2026-10-03", endDate: "2026-10-03" });
  });
  it("opens a conversation with its usage over time and messages", async () => {
    const { engine, request } = engineWith({ ...BASE, "sessions.usage.timeseries": { points: [{ totalTokens: 10, cumulativeTokens: 10 }] }, "sessions.usage.logs": { logs: [{ role: "user", content: "Add up the receipts", timestamp: 1 }] } });
    await show(engine, "advanced");
    await click("Open the report");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".s2usage-conv .link-k")][0].click()); await flush();
    expect(calls(request, "sessions.usage.timeseries")[0]).toEqual({ key: "agent:main:a", agentId: "main" });
    expect(document.querySelector(".s2usage-det")?.textContent).toContain("Add up the receipts");
  });
  it("exports each day as a CSV download", async () => {
    const make = vi.fn(() => "blob:x"); const drop = vi.fn();
    Object.assign(URL, { createObjectURL: make, revokeObjectURL: drop });
    const { engine } = engineWith(BASE);
    await show(engine, "advanced");
    await click("Open the report");
    await click("Export");
    await click("Each day (CSV)");
    expect(make).toHaveBeenCalledTimes(1);
    const blob = (make.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toContain("2026-10-03,4000,2.0000");
    expect(drop).toHaveBeenCalledWith("blob:x");
  });
});

describe("keeping things", () => {
  it("Keep conversations saves 30 days as enforced pruning", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG({ session: { maintenance: { mode: "enforce", pruneAfter: "365d" } } }) });
    await show(engine);
    await click("30 days", row("Keep conversations")!);
    expect(patched(request)).toContainEqual({ session: { maintenance: { mode: "enforce", pruneAfter: "30d" } } });
  });
  it("Keep conversations saves Forever as warn mode", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG() });
    await show(engine);
    await click("Forever", row("Keep conversations")!);
    expect(patched(request)).toContainEqual({ session: { maintenance: { mode: "warn" } } });
  });
  it("Keep conversations selects 1 year from enforced 365-day config", async () => {
    const { engine } = engineWith({ ...BASE, ...CFG({ session: { maintenance: { mode: "enforce", pruneAfter: "365d" } } }) });
    await show(engine);
    expect(button("1 year", row("Keep conversations")!).getAttribute("aria-pressed")).toBe("true");
  });
  it("Keep conversations shows a custom 90-day retention without selecting a preset", async () => {
    const { engine } = engineWith({ ...BASE, ...CFG({ session: { maintenance: { mode: "enforce", pruneAfter: "90d" } } }) });
    await show(engine);
    const keep = row("Keep conversations")!;
    expect(keep.textContent).toContain("Now: 90 days.");
    expect([...keep.querySelectorAll('button[aria-pressed="true"]')]).toHaveLength(0);
  });
  it("saves the tidy rules and the upload clean-up through config.patch", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG() });
    await show(engine, "advanced");
    await click("Only warn");
    expect(patched(request)).toContainEqual({ session: { maintenance: { mode: "warn" } } });
    const ttl = document.querySelector<HTMLSelectElement>('select[aria-label="Delete uploaded files after"]')!;
    await act(async () => { ttl.value = "24"; ttl.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    expect(patched(request)).toContainEqual({ attachments: { ttlHours: 24 } });
    const idle = document.querySelector<HTMLInputElement>('input[aria-label="Archive conversations idle for"]')!;
    expect(idle.placeholder).toBe("30");
  });
  it("Tidy now runs sessions.cleanup and says what it did", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG(), "sessions.cleanup": { allAgents: true, mode: "enforce", stores: [{ archived: 2, capArchived: 0, pruned: 1, capped: 0, modelRunPruned: 0 }] } });
    await show(engine, "advanced");
    await click("Tidy");
    expect(calls(request, "sessions.cleanup")[0]).toEqual({ allAgents: true });
    expect(row("Tidy now")?.textContent).toContain("2 archived, 1 removed.");
  });
  it("Run now waits for the compress switch, then asks sessions.storage.run", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG({ session: { maintenance: { coldStorage: { enabled: true } } } }), "sessions.storage.run": { agents: [], maintenance: { running: true } } });
    await show(engine, "advanced");
    await click("Run now");
    expect(calls(request, "sessions.storage.run")).toHaveLength(1);
    expect(row("Run now")?.textContent).toContain("Packing transcripts now.");
  });
  it("turns other assistants' conversations on and off through their plugins", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG() });
    await show(engine);
    const sw = row("Show other assistants’ conversations")!.querySelector<HTMLInputElement>("input")!;
    expect(sw.checked).toBe(true);
    await act(async () => sw.click()); await flush();
    expect(patched(request)).toContainEqual({ plugins: { entries: { codex: { config: { sessionCatalog: { enabled: false } } } } } });
    expect(JSON.stringify(patched(request))).not.toContain("opencode");
  });
  it("greys an app whose plugin isn't installed", async () => {
    const { engine } = engineWith({ ...BASE, ...CFG() });
    await show(engine, "advanced");
    expect(row("Show OpenCode conversations")?.textContent).toContain("plugin isn’t installed");
    expect(row("Show Codex conversations")?.getAttribute("aria-disabled")).toBeNull();
  });
  it("More Codex folders adds and removes paths in sessionCatalog.homes", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG({ plugins: { entries: { codex: { config: { sessionCatalog: { homes: ["D:/old"] } } } } } }) });
    await show(engine, "technical");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="More Codex folders: add"]')!;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(input, "D:/new"); input.dispatchEvent(new Event("input", { bubbles: true })); }); await flush();
    await click("Add", row("More Codex folders")!);
    expect(patched(request)).toContainEqual({ plugins: { entries: { codex: { config: { sessionCatalog: { homes: ["D:/old", "D:/new"] } } } } } });
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Remove D:/old"]')!.click()); await flush();
    expect(patched(request)).toContainEqual({ plugins: { entries: { codex: { config: { sessionCatalog: { homes: [] } } } } } });
  });
  it("Technical: every session key saves at its real path, and bad JSON is refused", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG() });
    await show(engine, "technical");
    const mode = document.querySelector<HTMLSelectElement>('select[aria-label="session.reset.mode"]')!;
    await act(async () => { mode.value = "daily"; mode.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
    expect(patched(request)).toContainEqual({ session: { reset: { mode: "daily" } } });
    const links = document.querySelector<HTMLInputElement>('input[aria-label="session.identityLinks"]')!;
    const before = calls(request, "config.patch").length;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(links, "{nope"); links.dispatchEvent(new Event("input", { bubbles: true })); links.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }); await flush();
    expect(calls(request, "config.patch").length).toBe(before);
    expect(document.querySelector('[data-row="session.identityLinks"]')?.textContent).toContain("isn’t valid JSON");
  });
  it("Manage deletes the picked conversations one by one", async () => {
    const { engine, request } = engineWith({ ...BASE, "sessions.list": { sessions: [{ key: "agent:main:x", agentId: "main", label: "Old chat", updatedAt: 1 }] }, "sessions.delete": { ok: true } });
    await show(engine, "advanced");
    await click("Manage");
    const box = document.querySelector<HTMLInputElement>('.dlg .prow input[type="checkbox"]')!;
    await act(async () => box.click()); await flush();
    await click("Delete", document.querySelector(".dlg")!);
    await click("Delete", document.querySelector(".dlg")!);
    expect(calls(request, "sessions.delete")[0]).toEqual({ key: "agent:main:x", agentId: "main" });
  });
});

describe("moving and backups", () => {
  it("Move in plans with migrations.memory.plan, then applies the planned items", async () => {
    const plan = { agentId: "main", providers: [{ providerId: "claude", label: "Claude Code", found: true, planFingerprint: "f".repeat(64), summary: {}, items: [{ id: "i1", status: "planned", target: "MEMORY.md" }, { id: "i2", status: "skipped" }] }] };
    const { engine, request } = engineWith({ ...BASE, ...CFG(), "migrations.memory.plan": plan, "migrations.memory.apply": { providerId: "claude", source: "x", summary: { migrated: 1, errors: 0, conflicts: 0 }, items: [] } });
    await show(engine);
    await click("Move in…");
    expect(calls(request, "migrations.memory.plan")[0]).toEqual({ agentId: "main" });
    await act(async () => document.querySelector<HTMLButtonElement>(".dlg .s2-opt")!.click()); await flush();
    await click("Bring it in");
    expect(calls(request, "migrations.memory.apply")[0]).toMatchObject({ agentId: "main", providerId: "claude", planFingerprint: "f".repeat(64), itemIds: ["i1"] });
    expect(document.querySelector(".dlg")?.textContent).toContain("1 brought in");
  });
  it("Backups reads backup.status, and Check probes the place", async () => {
    const status = { targets: [{ kind: "archive", target: "Backups folder", latest: { id: "b", createdAt: 1, archivePath: "x", status: "ok", kind: "archive" } }], schedules: [], locations: [{ name: "home-nas", provider: "local", encrypted: false }] };
    const { engine, request } = engineWith({ ...BASE, ...CFG(), "backup.status": status, "storage.locations.probe": { state: "ok", message: "Reachable" } });
    await show(engine, "advanced");
    await click("See backups");
    const dlg = document.querySelector(".dlg")!;
    expect(dlg.textContent).toContain("Backups folder");
    expect(button("Back up now", dlg).disabled).toBe(true);
    await click("Check", dlg);
    expect(calls(request, "storage.locations.probe")[0]).toEqual({ name: "home-nas" });
    expect(dlg.textContent).toContain("Reachable");
  });
  it("Prepaid balances asks usage.status again and shows each balance", async () => {
    const status = { updatedAt: 1, providers: [{ provider: "openrouter", displayName: "OpenRouter", windows: [], billing: [{ type: "balance", amount: 12.4, unit: "USD" }] }] };
    const { engine, request } = engineWith({ ...BASE, ...CFG(), "usage.status": status });
    await show(engine, "advanced");
    const before = calls(request, "usage.status").length;
    await click("Check now");
    expect(calls(request, "usage.status").length).toBe(before + 1);
    expect(row("Prepaid balances")?.textContent).toContain("OpenRouter: $12.40");
  });
  it("Conversation storage reads sessions.storage.status", async () => {
    const storage = { agents: [{ agentId: "main", hotTranscripts: 5, coldTranscripts: 2, databaseBytes: 2048, walBytes: 0, archiveBytes: 0, embeddedArchiveBytes: 0 }], maintenance: { running: false, lastCompletedAt: null, archivedTranscripts: 0, lastError: null } };
    const { engine } = engineWith({ ...BASE, ...CFG(), "sessions.storage.status": storage });
    await show(engine, "advanced");
    await click("See it");
    expect(document.querySelector(".dlg")?.textContent).toContain("5 uncompressed · 2 archived");
    expect(document.querySelector('[data-row="What’s kept on this computer"]')?.textContent).toContain("7 · 2 KB");
  });
});

describe("helpers", () => {
  it("words the reset time", () => {
    const now = new Date(2026, 9, 3, 12, 0).getTime();
    expect(resetWords(new Date(2026, 9, 3, 18, 0).getTime(), now)).toBe("resets at 6 pm");
    expect(resetWords(new Date(2026, 9, 3, 19, 40).getTime(), now)).toBe("resets at 7:40 pm");
    expect(resetWords(new Date(2026, 9, 5, 9, 0).getTime(), now)).toMatch(/^resets [A-Z][a-z]+day$/);
  });
  it("reads durations and sizes", () => {
    expect(daysFrom("30d")).toBe("30"); expect(daysFrom("12h")).toBe("0.5"); expect(daysFrom(7)).toBe("7");
    expect(gbFrom("10gb")).toBe("10"); expect(gbFrom(512 * 1024 ** 2)).toBe("0.5"); expect(gbFrom(false)).toBe("");
  });
  it("parses and applies the Technical query box", () => {
    expect(parseQuery("has:errors minCost:0.50 foo:bar").warns).toEqual(["Unknown filter: foo"]);
    const c = { key: "k", agentId: "main", name: "Quarterly numbers", trunk: "Sapling", tokens: 10, cost: 2, messages: 3, errors: 1, updated: 0, model: "gpt-5", provider: "openai", channel: "webchat", tools: 0 };
    expect(matches(c, "model:gpt has:errors minCost:1")).toBe(true);
    expect(matches(c, "maxCost:1")).toBe(false);
  });
  it("words a clean-up result", () => {
    expect(tidyNote({ mode: "warn", archived: 1, pruned: 0, capped: 0 })).toBe("Only warn is on: 1 archived, 0 removed.");
  });
});
