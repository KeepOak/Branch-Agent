// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { ScheduledTab } from "./Scheduled";
import { addParams, draftFromJob, draftFromWords, failureParams, updateParams } from "./draft";
import { cronLine, guessFromWords, health, scheduleToForm, scheduleWords, autoDisabledWords } from "./model";
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const job = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, enabled: true, agentId: "main", configRevision: `r-${id}`, schedule: { kind: "cron", expr: "30 7 * * 1-5" }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: name }, delivery: { mode: "announce" }, state: { nextRunAtMs: now + 3600e3 }, ...extra });
const runs = (jobId: string, n: number, failed = 0) => Array.from({ length: n }, (_, i) => ({ ts: now - i * 1000, jobId, action: "finished", status: i < failed ? "error" : "ok", durationMs: 1000 + i * 10 }));
const FX: Record<string, unknown> = {
  "cron.list": { jobs: [job("a", "Morning brief"), job("b", "Price check", { enabled: false, state: { autoDisabled: { reason: "consecutive-failures", atMs: now, consecutiveErrors: 10 } } })], hasMore: false },
  "cron.status": { enabled: true },
  "cron.runs": { entries: [...runs("a", 12), ...runs("b", 7, 7)], hasMore: false },
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }] },
  "models.list": { models: [] },
  "config.get": { hash: "h1", config: {} },
  "config.patch": { ok: true },
  "cron.add": { id: "new", state: { nextRunAtMs: now + 3600e3 } },
  "cron.update": { id: "a" },
};
let root: Root | null = null, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
function engine(fx: Record<string, unknown> = FX, scopes = ["operator.admin"]) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const p = (params ?? {}) as { scope?: string; id?: string; limit?: number };
    if (method === "cron.runs" && p.scope === "job" && p.limit === 50) { const all = (fx["cron.runs"] as { entries: { jobId: string }[] }).entries.filter(e => e.jobId === p.id); return { entries: all, total: all.length }; }
    return method in fx ? fx[method] : {};
  });
  return { request, engine: { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, agentId: "main", scopes } as WindowEngine };
}
async function mount(e: WindowEngine, level: Level = "regular") {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<ScheduledTab engine={e} level={level} openConversation={() => {}} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text) as HTMLButtonElement;
async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
async function type(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function describeIt(words: string) { await type(host.querySelector("input[aria-label='Describe a new automation']")!, words); await click(button("Add")); }

describe("Automations › Scheduled", () => {
  it("Add with nothing described keeps the button live and puts the cursor in the field", async () => {
    await mount(engine().engine);
    expect(button("Add").disabled).toBe(false);
    await click(button("Add"));
    expect(document.activeElement).toBe(host.querySelector("input[aria-label='Describe a new automation']"));
    expect(host.querySelector("[aria-label=Repeats]")).toBeNull();
  });
  it("draws the face, the health readout and Turned itself off from the engine", async () => {
    await mount(engine().engine);
    expect(host.querySelectorAll("[role=img][aria-label=Sapling]").length).toBe(2);
    expect(host.textContent).toContain("12 runs · all fine");
    expect(host.textContent).toContain("7 runs · 7 failed");
    expect(host.textContent).toContain("Turned itself off · 10 failed runs");
    expect(host.querySelector(".au-spark")).toBeTruthy();
  });
  it("Regular: Repeats segmented and no cron line; Confirm sends cron.add with the chosen schedule", async () => {
    const { engine: e, request } = engine();
    await mount(e);
    await describeIt("every weekday at 8, check my inbox for invoices");
    expect(host.querySelector("[aria-label=Repeats]")).toBeTruthy();
    expect(host.querySelector("[aria-label='Cron line']")).toBeNull();
    expect(host.textContent).toContain("Sends to");
    expect(host.textContent).not.toContain("Results destination");
    await click(button("Confirm the schedule"));
    expect(request).toHaveBeenCalledWith("cron.add", expect.objectContaining({ name: "Check my inbox for invoices", schedule: { kind: "cron", expr: "0 8 * * 1-5" }, sessionTarget: "isolated", payload: { kind: "agentTurn", message: "Check my inbox for invoices" }, delivery: { mode: "announce" }, agentId: "main", enabled: true }));
  });
  it("Confirm and run now saves once; a refused first run never adds it twice", async () => {
    const { engine: e, request } = engine({ ...FX, "cron.run": { ok: true, ran: false, reason: "already-running" } });
    await mount(e);
    await describeIt("every day at 9, check prices");
    await click(button("Confirm and run now"));
    expect(request).toHaveBeenCalledWith("cron.run", { id: "new", mode: "force" });
    expect(button("Confirm and run now")).toBeUndefined();
    expect(request.mock.calls.filter(c => c[0] === "cron.add")).toHaveLength(1);
  });
  it("a cron line Repeats can't show reads as words below Technical", async () => {
    const { engine: e } = engine({ ...FX, "cron.list": { jobs: [job("a", "Often", { schedule: { kind: "cron", expr: "*/5 * * * *" } })], hasMore: false } });
    await mount(e);
    expect(host.textContent).toContain("Every 5 minutes · Sapling");
    expect(host.textContent).not.toContain("*/5");
  });
  it("closing a changed Change… card asks Leave without saving?", async () => {
    const { engine: e, request } = engine();
    await mount(e);
    const openChange = async () => { await act(async () => { host.querySelector("[data-testid=au-row]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); }); await click([...document.querySelectorAll("[role=menuitem]")].find(b => b.textContent === "Change…")!); };
    await openChange();
    await click(button("Cancel"));
    expect(document.querySelector("[data-testid=au-leave]")).toBeNull();
    expect(host.textContent).not.toContain("Change the schedule");
    await openChange();
    await type(host.querySelector("input[aria-label='It does']")!, "Morning news");
    await click(button("Cancel"));
    const leave = document.querySelector("[data-testid=au-leave]")!;
    expect(leave.textContent).toContain("Leave without saving?");
    expect(leave.textContent).toContain("Your changes to this schedule aren’t saved.");
    await click([...leave.querySelectorAll("button")].find(b => b.textContent === "Keep editing")!);
    expect(document.querySelector("[data-testid=au-leave]")).toBeNull();
    expect((host.querySelector("input[aria-label='It does']") as HTMLInputElement).value).toBe("Morning news");
    await click(button("Cancel"));
    await click([...document.querySelectorAll("[data-testid=au-leave] button")].find(b => b.textContent === "Leave")!);
    expect(host.textContent).not.toContain("Change the schedule");
    expect(request.mock.calls.some(c => c[0] === "cron.update")).toBe(false);
  });
  it("Technical shows the cron line as an editable field", async () => {
    await mount(engine().engine, "technical");
    await describeIt("every day at 7, read the news");
    const input = host.querySelector("input[aria-label='Cron line']") as HTMLInputElement;
    expect(input.value).toBe("0 7 * * *");
    expect(input.disabled).toBe(false);
  });
  it("Advanced adds the summary line, find and sort, Run if it's due and When it fails…", async () => {
    await mount(engine().engine, "advanced");
    expect(host.textContent).toContain("2 automations · 1 failing");
    expect(host.querySelector("input[aria-label='Search automations']")).toBeTruthy();
    const row = host.querySelector("[data-testid=au-row]")!;
    await act(async () => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    const items = [...document.querySelectorAll("[role=menuitem]")].map(b => b.textContent);
    expect(items).toEqual(["Run now", "Run if it’s due", "Change…", "Change where it sends…", "Duplicate", "When it fails…", "Remove…"]);
  });
  it("Regular row menu leaves out the Advanced items", async () => {
    await mount(engine().engine);
    await act(async () => { host.querySelector("[data-testid=au-row]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
    expect([...document.querySelectorAll("[role=menuitem]")].map(b => b.textContent)).toEqual(["Run now", "Change…", "Change where it sends…", "Duplicate", "Remove…"]);
  });
  it("the switch sends cron.update with the revision it read", async () => {
    const { engine: e, request } = engine();
    await mount(e);
    await click(host.querySelector("[aria-label='Morning brief on or off']")!);
    expect(request).toHaveBeenCalledWith("cron.update", { id: "a", expectedConfigRevision: "r-a", patch: { enabled: false } });
  });
  it("Run now sends cron.run force", async () => {
    const { engine: e, request } = engine({ ...FX, "cron.run": { ok: true, enqueued: true, runId: "x" } });
    await mount(e);
    await act(async () => { host.querySelector("[data-testid=au-row]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
    await click([...document.querySelectorAll("[role=menuitem]")].find(b => b.textContent === "Run now")!);
    expect(request).toHaveBeenCalledWith("cron.run", { id: "a", mode: "force" });
  });
  it("Paused banner resumes through config.patch on cron.enabled with the read revision", async () => {
    const { engine: e, request } = engine({ ...FX, "cron.status": { enabled: false } });
    await mount(e);
    expect(host.textContent).toContain("Every automation is paused");
    await click(button("Resume all"));
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h1", raw: JSON.stringify({ cron: { enabled: true } }) });
  });
  it("parts with no engine store are greyed with a reason, and look-only people can't change anything", async () => {
    await mount(engine(FX, ["operator.read"]).engine);
    const add = [...host.querySelectorAll(".au-sec button")].filter(b => b.textContent === "Add") as HTMLButtonElement[];
    expect(add.length).toBeGreaterThan(0);
    for (const b of add) { expect(b.disabled).toBe(true); expect(b.title).toBe(""); }
    expect(visibleDevNotes(host)).toEqual([]);
    expect((host.querySelector("[aria-label='Morning brief on or off']") as HTMLButtonElement).disabled).toBe(true);
  });
  it("the sheet opens on Runs and reads cron.runs for that one automation", async () => {
    const { engine: e, request } = engine();
    await mount(e);
    await click(button("Morning brief"));
    expect(request).toHaveBeenCalledWith("cron.runs", { scope: "job", id: "a", limit: 5, offset: 0, sortDir: "desc" });
    expect(document.querySelector("[data-testid=au-sheet]")?.textContent).toContain("Runs");
  });
});

describe("schedule words and drafts", () => {
  it("guesses Repeats and At from words, leaving everything editable", () => {
    const g = guessFromWords("every weekday at 8, check my inbox for invoices");
    expect(g.form.repeat).toBe("weekdays"); expect(g.form.time).toBe("08:00"); expect(g.task).toBe("Check my inbox for invoices");
    expect(guessFromWords("every 15 minutes check the build").form).toMatchObject({ repeat: "every", everyN: "15", everyUnit: "minutes" });
    expect(guessFromWords("fridays at 5pm send the report").form).toMatchObject({ repeat: "weekly", weekday: 5, time: "17:00" });
  });
  it("round-trips the Repeats choices through cron lines", () => {
    expect(scheduleToForm({ kind: "cron", expr: "0 17 * * 5" })).toMatchObject({ repeat: "weekly", weekday: 5, time: "17:00" });
    expect(cronLine(scheduleToForm({ kind: "cron", expr: "15 6 1 * *" }))).toBe("15 6 1 * *");
    expect(scheduleToForm({ kind: "cron", expr: "*/5 * * * *" }).repeat).toBe("custom");
    expect(scheduleWords({ kind: "cron", expr: "30 7 * * 1-5" })).toBe("Weekdays at 7:30 AM");
    expect(scheduleWords({ kind: "every", everyMs: 1800000 })).toBe("Every 30 minutes");
  });
  it("health and the auto-disabled words come from the engine's records", () => {
    expect(health([])).toBeNull();
    expect(health(runs("a", 3, 1))?.text).toBe("3 runs · 1 failed");
    expect(health(runs("a", 3))?.points).toBe("");
    expect(autoDisabledWords({ state: { autoDisabled: { reason: "schedule-errors", consecutiveErrors: 3 } } })).toBe("Turned itself off · 3 schedule errors");
  });
  it("Change… patches only what changed and keeps delivery and failure alerts", () => {
    const original = job("a", "Morning brief", { failureAlert: { after: 3 } });
    const d = { ...draftFromJob(original, "edit"), name: "Morning news" };
    expect(updateParams(d)).toEqual({ id: "a", expectedConfigRevision: "r-a", patch: { name: "Morning news" } });
  });
  it("Duplicate of a command automation starts with It does empty", () => {
    const d = draftFromJob(job("c", "Backup", { payload: { kind: "command", argv: ["backup"] } }), "copy", "Backup copy");
    expect(d.message).toBe(""); expect(d.payloadKind).toBe("agentTurn");
    expect(() => addParams(d)).toThrow("Say what it does.");
  });
  it("Nowhere and a web address map to the engine's delivery modes", () => {
    const d = draftFromWords("every day at 9, check prices", "main");
    expect(addParams({ ...d, sendsTo: "nowhere" }).delivery).toEqual({ mode: "none" });
    expect(addParams({ ...d, sendsTo: "webhook", webhook: "https://example.com/hook" }).delivery).toEqual({ mode: "webhook", to: "https://example.com/hook" });
    expect(() => addParams({ ...d, sendsTo: "webhook", webhook: "https://a:b@example.com" })).toThrow("without a name or password");
  });
  it("When it fails… sends failureAlert: null, false or its own policy", () => {
    const j = job("a", "Morning brief");
    expect(failureParams(j, { use: "usual", after: "2", cooldown: "60", how: "announce", to: "" }).patch).toEqual({ failureAlert: null });
    expect(failureParams(j, { use: "off", after: "2", cooldown: "60", how: "announce", to: "" }).patch).toEqual({ failureAlert: false });
    expect(failureParams(j, { use: "own", after: "2", cooldown: "60", how: "announce", to: "" }).patch).toEqual({ failureAlert: { after: 2, cooldownMs: 3600000, mode: "announce" } });
  });
});
