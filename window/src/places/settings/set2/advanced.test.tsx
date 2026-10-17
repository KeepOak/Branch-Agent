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

  it("a list's Add stays off until a folder is typed, then saves it", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine);
    const section = row("Extra folders to search");
    const add = button("Add a folder", section);
    expect(add.disabled).toBe(true);
    const field = section.querySelector("input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "D:/Notes"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(add.disabled).toBe(false);
    await click(add);
    expect(patches(request)).toContainEqual({ memory: { search: { extraPaths: ["D:/Notes"] } } });
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

  it("defaults meaning search to on this computer", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine);
    expect((row("Meaning search uses").querySelector("select") as HTMLSelectElement).value).toBe("local");
    expect(row("Meaning search uses").textContent).toContain("On this computer");
  });

  it("meaning search Test probes the embeddings", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "doctor.memory.status": (p: Record<string, unknown>) => (p.probe ? { provider: "openai", embedding: { ok: true, checked: true } } : { provider: "openai", embedding: { ok: false, checked: false } }) });
    await show(engine);
    expect(row("Meaning search").textContent).toContain("Not checked yet");
    await click(button("Test", row("Meaning search")));
    expect(request).toHaveBeenCalledWith("doctor.memory.status", { agentId: "main", probe: true });
    expect(row("Meaning search").textContent).toContain("Working");
  });

  it("reads and writes each LanceDB memory setting through config.patch", async () => {
    const entry = (config: Record<string, unknown>) => ({ plugins: { entries: { "memory-lancedb": { config } } } });
    const fill = async (title: string, value: string) => {
      const input = row(title).querySelector("input") as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      await flush();
    };
    const toggle = (title: string) => click(row(title).querySelector("input") as HTMLElement);

    const unset = engineWith(CONFIG);
    await show(unset.engine, "advanced");
    expect(row("Recall memories before a reply").textContent).toContain("Turn on LanceDB memory for this to apply.");
    expect((row("Recall memories before a reply").querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect((row("Save memories from the conversation").querySelector("input") as HTMLInputElement).checked).toBe(false);
    expect((row("Key for the meaning service").querySelector("input") as HTMLInputElement).type).toBe("password");
    expect((row("Meaning service for LanceDB").querySelector("input") as HTMLInputElement).placeholder).toBe("openai");
    await toggle("Recall memories before a reply");
    await toggle("Save memories from the conversation");
    await fill("Meaning service for LanceDB", "ollama");
    await fill("Meaning model", "mxbai-embed-large");
    await fill("Key for the meaning service", "sk-test");
    await fill("Address of the meaning service", "http://127.0.0.1:11434");
    await fill("How many numbers describe each memory", "1024");
    await fill("How long a saved memory may be", "200");
    await fill("Phrases that mean remember this", "remember this");
    await fill("How long a recalled memory may be", "400");
    expect(patches(unset.request)).toEqual([
      entry({ autoRecall: false }),
      entry({ autoCapture: true }),
      entry({ embedding: { provider: "ollama" } }),
      entry({ embedding: { model: "mxbai-embed-large" } }),
      entry({ embedding: { apiKey: "sk-test" } }),
      entry({ embedding: { baseUrl: "http://127.0.0.1:11434" } }),
      entry({ embedding: { dimensions: 1024 } }),
      entry({ captureMaxChars: 200 }),
      entry({ customTriggers: ["remember this"] }),
      entry({ recallMaxChars: 400 }),
    ]);

    const saved = {
      autoRecall: false,
      autoCapture: true,
      captureMaxChars: 200,
      recallMaxChars: 400,
      customTriggers: ["remember this"],
      embedding: { provider: "ollama", model: "mxbai-embed-large", apiKey: "sk-test", baseUrl: "http://127.0.0.1:11434", dimensions: 1024 },
    };
    const set = engineWith({ ...CONFIG, "config.get": { hash: "h", valid: true, config: { plugins: { entries: { "memory-lancedb": { enabled: true, config: saved } } } } } });
    await show(set.engine, "advanced");
    expect(row("Recall memories before a reply").textContent).not.toContain("Turn on LanceDB memory");
    expect((row("Recall memories before a reply").querySelector("input") as HTMLInputElement).checked).toBe(false);
    expect((row("Save memories from the conversation").querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect((row("Meaning service for LanceDB").querySelector("input") as HTMLInputElement).value).toBe("ollama");
    expect(row("Phrases that mean remember this").textContent).toContain("remember this");
    await toggle("Recall memories before a reply");
    await toggle("Save memories from the conversation");
    await fill("Meaning service for LanceDB", "github-copilot");
    await fill("Meaning model", "text-embedding-3-small");
    await fill("Key for the meaning service", "sk-next");
    await fill("Address of the meaning service", "http://127.0.0.1:11435");
    await fill("How many numbers describe each memory", "2048");
    await fill("How long a saved memory may be", "600");
    await fill("Phrases that mean remember this", "prefer");
    await fill("How long a recalled memory may be", "800");
    expect(patches(set.request)).toEqual([
      entry({ autoRecall: true }),
      entry({ autoCapture: false }),
      entry({ embedding: { provider: "github-copilot" } }),
      entry({ embedding: { model: "text-embedding-3-small" } }),
      entry({ embedding: { apiKey: "sk-next" } }),
      entry({ embedding: { baseUrl: "http://127.0.0.1:11435" } }),
      entry({ embedding: { dimensions: 2048 } }),
      entry({ captureMaxChars: 600 }),
      entry({ customTriggers: ["remember this", "prefer"] }),
      entry({ recallMaxChars: 800 }),
    ]);
  });

  it("lists every row for the settings search", () => {
    expect(ROWS.find((r) => r.title === "Logs")).toBeUndefined();
    expect(ROWS.find((r) => r.title === "How much the log keeps")).toMatchObject({ sec: "Logs", lv: 2 });
    expect(ROWS.find((r) => r.title === "Show the thinking")).toMatchObject({ sec: "Seeing more", lv: 1 });
  });
});

const STRUCTURED = {
  plugins: {
    entries: {
      "llm-task": {
        enabled: true,
        llm: { allowModelOverride: true, allowedCompletionModels: ["openai/gpt-5"] },
        config: { defaultProvider: "openai", defaultModel: "gpt-5", maxTokens: 800, timeoutMs: 10000 },
      },
    },
  },
  tools: { alsoAllow: ["llm-task"] },
};
const MODELS = { "models.list": { models: [{ provider: "openai", id: "gpt-5", name: "GPT-5", available: true }, { provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", available: true }] } };
async function typeNum(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await flush();
}

describe("Settings › Advanced › structured answers", () => {
  it("reads unset values as off and writes the engine keys when they change", async () => {
    const { engine, request } = engineWith({ ...CONFIG, ...MODELS });
    await show(engine, "advanced");
    const sw = row("Structured answers").querySelector("input[role=switch]") as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(row("Structured answers").textContent).toContain("Off until you choose");
    expect((row("Model for structured answers").querySelector("select") as HTMLSelectElement).value).toBe("");
    expect((row("Longest structured answer").querySelector("input") as HTMLInputElement).value).toBe("");
    expect((row("Longest structured answer").querySelector("input") as HTMLInputElement).placeholder).toBe("No limit");
    expect((row("Answer time limit").querySelector("input") as HTMLInputElement).placeholder).toBe("30,000");
    expect(row("Models it may use").textContent).toContain("Nothing here yet.");

    await click(sw);
    expect(patches(request)).toEqual([
      { plugins: { entries: { "llm-task": { enabled: true } } } },
      { tools: { alsoAllow: ["llm-task"] } },
    ]);

    const model = row("Model for structured answers").querySelector("select") as HTMLSelectElement;
    await act(async () => { model.value = "openai/gpt-5"; model.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { defaultProvider: "openai" } } } } });
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { defaultModel: "gpt-5" } } } } });
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { llm: { allowModelOverride: true } } } } });

    await typeNum(row("Longest structured answer").querySelector("input") as HTMLInputElement, "800");
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { maxTokens: 800 } } } } });
    await typeNum(row("Answer time limit").querySelector("input") as HTMLInputElement, "10000");
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { timeoutMs: 10000 } } } } });

    const models = row("Models it may use");
    const field = models.querySelector("input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "openai/gpt-5"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button("Add", models));
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { llm: { allowedCompletionModels: ["openai/gpt-5"] } } } } });
  });

  it("reads set values and writes the next change", async () => {
    const { engine, request } = engineWith({ ...CONFIG, ...MODELS, "config.get": { hash: "h", valid: true, config: STRUCTURED } });
    await show(engine, "advanced");
    const sw = row("Structured answers").querySelector("input[role=switch]") as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect((row("Model for structured answers").querySelector("select") as HTMLSelectElement).value).toBe("openai/gpt-5");
    expect((row("Longest structured answer").querySelector("input") as HTMLInputElement).value).toBe("800");
    expect((row("Answer time limit").querySelector("input") as HTMLInputElement).value).toBe("10,000");
    expect(row("Models it may use").textContent).toContain("openai/gpt-5");

    const model = row("Model for structured answers").querySelector("select") as HTMLSelectElement;
    await act(async () => { model.value = "openai/gpt-5-mini"; model.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { defaultModel: "gpt-5-mini" } } } } });

    await typeNum(row("Longest structured answer").querySelector("input") as HTMLInputElement, "400");
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { maxTokens: 400 } } } } });
    await typeNum(row("Answer time limit").querySelector("input") as HTMLInputElement, "5000");
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { config: { timeoutMs: 5000 } } } } });

    await click(sw);
    expect(patches(request)).toContainEqual({ plugins: { entries: { "llm-task": { enabled: false } } } });
    expect(patches(request)).toContainEqual({ tools: { alsoAllow: null } });
  });

  it("adds the tool to the existing allow list instead of a second list", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "config.get": { hash: "h", valid: true, config: { tools: { allow: ["read"] } } } });
    await show(engine, "advanced");
    expect((row("Structured answers").querySelector("input[role=switch]") as HTMLInputElement).checked).toBe(false);
    await click(row("Structured answers").querySelector("input") as HTMLElement);
    expect(patches(request)).toEqual([
      { plugins: { entries: { "llm-task": { enabled: true } } } },
      { tools: { allow: ["read", "llm-task"] } },
    ]);
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
