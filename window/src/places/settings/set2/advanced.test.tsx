// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { AdvancedPage, ROWS } from "./advanced";
import { fieldsOf, mergePatch, parseLine } from "./advanced-tech";
import { KitProvider } from "../kit";
import type { Pins } from "../pins";

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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine, level: "advanced" | "technical" = "technical") {
  await act(async () => root.render(<AdvancedPage page="advanced" title="Advanced" level={level} engine={engine} />));
  await flush();
}
const row = (title: string) => { const r = document.querySelector(`[data-row="${title}"]`); if (!r) throw new Error(`no row ${title}`); return r as HTMLElement; };
const button = (text: string, scope: ParentNode = document) => { const b = [...scope.querySelectorAll("button")].find((x) => x.textContent?.trim() === text); if (!b) throw new Error(`no button ${text}`); return b as HTMLButtonElement; };
const click = async (b: HTMLElement) => { await act(async () => b.click()); await flush(); };
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));
const CONFIG = { "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true } };

describe("Settings › Advanced", () => {
  it("keeps all six Technical section pins beside their titles and working", async () => {
    const { engine } = engineWith(CONFIG);
    const toggle = vi.fn();
    const pins: Pins = { page: "advanced", list: [], has: (title) => title === "Talk", toggle, go: vi.fn(), unpin: vi.fn() };
    const report = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
    await act(async () => root.render(<KitProvider level={2} report={report} scope={null} pins={pins}><AdvancedPage page="advanced" title="Advanced" level="technical" engine={engine} /></KitProvider>));
    await flush();
    for (const title of ["Text to speech", "Attachments", "Messages", "Talk", "Web", "Media"]) {
      const section = row(title);
      const pin = section.querySelector<HTMLButtonElement>(":scope > b > .pin-k");
      expect(pin, title).not.toBeNull();
      expect(section.querySelector(":scope > .pin-k"), title).toBeNull();
      expect(pin!.getAttribute("aria-pressed")).toBe(String(title === "Talk"));
      expect(pin!.getAttribute("aria-label")).toBe(`${title === "Talk" ? "Unpin" : "Pin"} ${title}`);
      await click(pin!);
      expect(toggle).toHaveBeenLastCalledWith(title);
    }
    await click(button("Edit", row("Text to speech")));
    expect(document.querySelector('[role="dialog"][aria-label="Text to speech"]')).not.toBeNull();
  });

  it("lists the preview's sections in order, gated by level", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine, "advanced");
    const secs = [...document.querySelectorAll("[data-sec]")].map((s) => s.getAttribute("data-sec"));
    expect(secs.slice(0, 4)).toEqual(["Seeing more", "Setup", "Commands", "Files"]);
    expect(secs).not.toContain("Logs");
    expect(secs).not.toContain("Health");
    expect(document.querySelector('[data-row="Keep a stability record"]')).toBeNull();
    await show(engine, "technical");
    const tech = [...document.querySelectorAll("[data-sec]")].map((s) => s.getAttribute("data-sec"));
    expect(tech).toEqual(expect.arrayContaining(["Logs", "Docker", "Hooks", "Network", "Everything else", "Health"]));
    expect(tech.indexOf("Logs")).toBe(1);
  });

  it("reads the service tiles from status, health and the browser", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "0.4.4-build-a300a48dba2f" })));
    const { engine } = engineWith({ ...CONFIG, status: { runtimeVersion: "2026.9.8", pid: 77 }, health: { ok: true, ts: 1 }, "system.info": { port: 4000 }, "browser.request": (p: Record<string, unknown>) => (p.path === "/tabs" ? { tabs: [{}, {}] } : { enabled: true, running: true, profile: "branch" }) });
    await show(engine);
    const tile = document.querySelector('[data-tile="Branch service"]') as HTMLElement;
    expect(tile.textContent).toContain("Running");
    expect(tile.textContent).toContain("0.4.4 · build a300a48d");
    expect(tile.textContent).not.toContain("2026.9.8");
    expect(tile.textContent).toContain("127.0.0.1:4000");
    expect((document.querySelector('[data-tile="Browser"]') as HTMLElement).textContent).toContain("2");
  });

  it("Restart asks the gateway to restart and says so", async () => {
    const { engine, request } = engineWith({ ...CONFIG, health: { ok: true }, "gateway.restart.request": { ok: true, status: "scheduled" } });
    await show(engine);
    await click(button("Restart", document.querySelector('[data-tile="Branch service"]') as HTMLElement));
    expect(request).toHaveBeenCalledWith("gateway.restart.request", { reason: "settings" });
    expect(document.body.textContent).toContain("Restarting. The window reconnects by itself.");
  });

  it("switches save their engine config path", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine);
    await click(row("Share anonymous feature counts").querySelector("input") as HTMLElement);
    await click(row("Show the thinking").querySelector("input") as HTMLElement);
    await click(row("Catch up on runs missed while Branch was off").querySelector("input") as HTMLElement);
    expect(patches(request)).toEqual([{ telemetry: { enabled: true } }, { agents: { defaults: { reasoningDefault: "on" } } }, { cron: { skipMissedJobs: true } }]);
  });

  it("keeps early-feature rationale in page help, not row descriptions", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine, "advanced");
    expect(row("Skip tools on plain chat").textContent).toContain("The decision model skips tools for plain chat.");
    expect(row("Skip tools on plain chat").textContent).not.toContain("Off until you choose");
    expect(row("Skip tools on plain chat").textContent).not.toContain("How it works");
    expect(row("Code mode").textContent).not.toContain("How it works");
    await act(async () => window.dispatchEvent(new Event("branch-settings-help")));
    const help = document.querySelector(".kit-help-pop") as HTMLElement;
    expect(help.textContent).toContain("Off until you choose: it’s an early feature");
    expect(help.textContent).toContain("A per-model choice lives in Settings › Models");
  });

  it("keeps Advanced rationale in page help while operational facts stay visible", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine);
    const moved = [
      "Share memory between Trunks", "Outside memory", "Reach webhooks from outside",
      "Only signed skill packages", "Let plugins add their own views", "Connector app views",
      "Run on GitHub Actions while this computer is off", "Also search past conversations",
      "Pictures and audio in extra folders", "Bring up what it remembers, mid-task",
      "Notes about this computer", "Keep notes about this computer",
      "Score memories by whether they helped", "Read text in scans and pictures",
      "Keep links from messages", "Describe each passage before indexing",
      "Ask a stronger model on hard calls", "Plan first on long tasks",
      "Wait for my yes on the plan", "Check the answer before saying done",
      "Take work over the agent protocol", "Tools lent by a connected program",
      "Carry a conversation on somewhere else", "Look after several assistants at once",
      "Other computers running Branch, side by side", "Trunks on other computers",
      "Steps for other apps",
    ];
    for (const title of moved) expect(row(title).textContent, title).not.toContain("Off until you choose");
    expect(row("Let plugins add their own views").querySelector("small")?.textContent).toContain("Their code runs with your sign-in, so turn it on only for plugins you trust.");
    expect(row("Pictures and audio in extra folders").querySelector("small")?.textContent).toContain("Files are uploaded to the meaning-search service.");
    expect(row("Tell me when an automation keeps failing").textContent).toContain("The alert goes wherever the automation already reports.");
    expect(row("Outside memory").getAttribute("aria-disabled")).toBe("true");
    expect(row("Code mode").querySelector("small")?.textContent?.length).toBeLessThanOrEqual(70);
    await act(async () => window.dispatchEvent(new Event("branch-settings-help")));
    const help = document.querySelector(".kit-help-pop") as HTMLElement;
    for (const title of moved) expect(help.textContent, title).toContain(title);
    expect(help.textContent).toContain("Off until you choose: it changes where your data goes.");
    expect(help.textContent).not.toContain("The alert goes wherever the automation already reports.");
    expect(help.textContent).not.toContain("This engine has none of these memory services.");
  });

  it("numbers convert units and empty means the engine's default", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine);
    const input = row("Start a new file at").querySelector("input") as HTMLInputElement;
    expect(input.placeholder).toBe("100");
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; set?.call(input, "20"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    expect(patches(request)).toContainEqual({ logging: { maxFileBytes: 20 * 1024 * 1024 } });
  });

  it("holds the audit rows while the activity log is off", async () => {
    const { engine } = engineWith({ ...CONFIG, "config.get": { hash: "h", valid: true, config: { logging: { audit: { enabled: false } } } } });
    await show(engine);
    expect(row("Record who ran each task").textContent).toContain("Turn on “Keep an activity log” first.");
    expect((row("Record who ran each task").querySelector("input") as HTMLInputElement).disabled).toBe(true);
  });

  it("plugin rows read plugins.list and save the plugin's own entry", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "plugins.list": { plugins: [{ id: "active-memory", name: "Active Memory", enabled: false, installed: true }] } });
    await show(engine);
    await click(row("Recall before replying").querySelector("input") as HTMLElement);
    expect(patches(request)).toContainEqual({ plugins: { entries: { "active-memory": { enabled: true } } } });
    // Greyed, without the developer note (shell/shown-why.ts).
    expect(row("Memory wiki").getAttribute("aria-disabled")).toBe("true");
    expect(row("Memory wiki").textContent).not.toContain("Its plugin isn’t installed in this engine.");
  });

  it("greyed rows stay greyed without developer notes, and say why otherwise", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine);
    expect(row("Send crash reports").getAttribute("aria-disabled")).toBe("true");
    expect(row("Send crash reports").textContent).not.toContain("The engine doesn’t send crash reports.");
    expect(row("Report for a bug").textContent).toContain("branch gateway diagnostics export");
  });

  it("the log window tails logs.tail and filters by level", async () => {
    const line = (lv: string, msg: string) => JSON.stringify({ 0: msg, time: "2026-10-03T10:00:00Z", _meta: { logLevelName: lv } });
    const { engine, request } = engineWith({ ...CONFIG, "logs.tail": { file: "/tmp/branch.log", cursor: 10, size: 10, lines: [line("INFO", "gateway ready"), line("ERROR", "browser timed out")] } });
    await show(engine);
    await click(button("Open", row("Gateway log")));
    expect(request).toHaveBeenCalledWith("logs.tail", { limit: 500 });
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.textContent).toContain("browser timed out");
    await click(button("Error", dlg));
    expect(dlg.textContent).not.toContain("browser timed out");
    expect(dlg.textContent).toContain("gateway ready");
  });

  it("the conversation table lists sessions and renames through sessions.patch", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "sessions.list": { sessions: [{ key: "agent:main:x", agentId: "main", label: "Taxes", updatedAt: 1, totalTokens: 50, contextTokens: 100 }], totalCount: 1 }, "sessions.patch": { ok: true } });
    await show(engine);
    await click(button("Open the table"));
    expect(request.mock.calls.find(([m]) => m === "sessions.list")?.[1]).toMatchObject({ archived: false, limit: 25, offset: 0 });
    await click(button("Taxes"));
    const input = document.querySelector('[aria-label="New name for Taxes"]') as HTMLInputElement;
    await act(async () => { input.value = "Tax year"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:main:x", agentId: "main", label: "Tax year" });
  });

  it("web search details test a search and show the engine's error", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "webSearch.status": { route: { label: "DuckDuckGo search", testable: true }, providers: [{ id: "duckduckgo", label: "DuckDuckGo", available: true }], testProvider: { id: "duckduckgo", label: "DuckDuckGo" } }, "webSearch.test": new Error("search refused") });
    await show(engine);
    await click(button("Open", row("Web search details")));
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const q = dlg.querySelector('[aria-label="Search for"]') as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; set?.call(q, "weather"); q.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button("Test DuckDuckGo", dlg));
    expect(request).toHaveBeenCalledWith("webSearch.test", { query: "weather", agentId: "main" });
    expect(dlg.textContent).toContain("search refused");
  });

  it("hooks list the engine's hooks under their events", async () => {
    const { engine } = engineWith({ ...CONFIG, "hooks.status": { managedHooksDir: "/hooks", hooks: [{ name: "session-memory", events: ["command:new"] }, { name: "boot", events: ["gateway:startup"] }] } });
    await show(engine);
    expect(row("When a conversation starts").textContent).toContain("session-memory");
    expect(row("Other engine events").textContent).toContain("boot");
  });

  it("meaning search Test probes the embeddings", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "doctor.memory.status": (p: Record<string, unknown>) => (p.probe ? { provider: "openai", embedding: { ok: true, checked: true } } : { provider: "openai", embedding: { ok: false, checked: false } }) });
    await show(engine);
    expect(row("Meaning search").textContent).toContain("Not checked yet");
    await click(button("Test", row("Meaning search")));
    expect(request).toHaveBeenCalledWith("doctor.memory.status", { agentId: "main", probe: true });
    expect(row("Meaning search").textContent).toContain("Working");
  });

  it("lists every row for the settings search", () => {
    expect(ROWS.find((r) => r.title === "Logs")).toBeUndefined();
    expect(ROWS.find((r) => r.title === "How much the log keeps")).toMatchObject({ sec: "Logs", lv: 2 });
    expect(ROWS.find((r) => r.title === "Show the thinking")).toMatchObject({ sec: "Seeing more", lv: 1 });
  });
});

describe("Advanced helpers", () => {
  it("makes a merge patch that removes keys and keeps unchanged ones out", () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 4 } })).toEqual({ b: { c: 4, d: null } });
    expect(mergePatch({ a: 1 }, { a: 1 })).toBeUndefined();
  });
  it("reads the logger's JSON lines", () => {
    expect(parseLine(JSON.stringify({ 0: JSON.stringify({ subsystem: "gateway" }), 1: "ready", _meta: { logLevelName: "WARN" } }))).toMatchObject({ level: "warn", text: "gateway: ready" });
    expect(parseLine("plain text")).toMatchObject({ text: "plain text", level: "" });
  });
  it("walks the config schema to its leaf paths", () => {
    const f = fieldsOf({ properties: { a: { properties: { b: { type: "boolean" } } }, c: { anyOf: [{ const: "x" }, { const: "y" }] } } }, { "a.b": { label: "B" } });
    expect(f).toEqual([{ path: "a.b", type: "boolean", label: "B", help: "" }, { path: "c", type: "x | y", label: "", help: "" }]);
  });
});
