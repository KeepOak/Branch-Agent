// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import type { Pins } from "../pins";
import { configStore } from "../config-store";
import { GENERAL_ROWS, GeneralPage } from "./general";
import { GENERAL_PREFS } from "./general-conversation";
import { ttlMinutes } from "./general-summaries";
import { IN_BROWSER } from "../../../connect/desktop-controls";
import { platformName } from "../../../setup/steps-later";
import { visibleDevNotes } from "../../../shell/shown-why.testing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

type Replies = Record<string, unknown>;
function engineOf(extra: Replies = {}, config: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method in extra) { const r = extra[method]; return typeof r === "function" ? (r as (p: unknown) => unknown)(params) : r; }
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.patch") return { ok: true, hash: "h2", config };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "projects.list") return { projects: [] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  return { engine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><GeneralPage page="general" title="General" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await configStore(engine).load(); });
}
const heads = () => [...host.querySelectorAll(".sec > h2:not([hidden])")].map((h) => h.textContent);
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const patchOf = (request: ReturnType<typeof engineOf>["request"]) => {
  const call = request.mock.calls.find(([m]) => m === "config.patch") as unknown as [string, { raw: string }];
  return JSON.parse(call[1].raw);
};
async function press(title: string, label: string) {
  await act(async () => [...row(title).querySelectorAll("button")].find((b) => b.textContent === label)!.click());
}

describe("Settings › General", () => {
  it("keeps a row pin beside its title, clear of the Show all control", async () => {
    const { engine } = engineOf();
    const pins: Pins = { page: "general", list: [], has: () => false, toggle: vi.fn(), go: vi.fn(), unpin: vi.fn() };
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null} pins={pins}><GeneralPage page="general" title="General" level="regular" engine={engine} /></KitProvider>));
    const keyboard = row("Keyboard shortcuts");
    expect(keyboard.querySelector("b > .pin-k")).not.toBeNull();
    await act(async () => keyboard.querySelector<HTMLButtonElement>(".right button")!.click());
    expect(document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')).not.toBeNull();
  });
  it("shows the preview's sections at each level", async () => {
    const { engine } = engineOf();
    await render(engine, 0);
    expect(heads()).toEqual(["Starting up", "Projects", "Keyboard", "Writing"]);
    await render(engine, 1);
    expect(heads()).toEqual(["Starting up", "Projects", "Keyboard", "Writing", "The conversation", "Summaries"]);
    await render(engine, 2);
    expect(heads()).toEqual(["Starting up", "Projects", "Keyboard", "Writing", "The conversation", "Summaries", "Waiting line"]);
  });

  it("every row the page draws is in the search list, with its exact title", async () => {
    const { engine } = engineOf();
    await render(engine, 2);
    const drawn = [...host.querySelectorAll<HTMLElement>(".ctl")].map((r) => r.dataset.row);
    expect(drawn.sort()).toEqual(GENERAL_ROWS.map((r) => r.title).sort());
  });

  it("lists projects from projects.list with their conversation count, or the empty line", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect(host.textContent).toContain("No projects yet.");
    const withOne = engineOf({ "projects.list": { projects: [{ id: "home", displayName: "Home", source: "registered" }] }, "sessions.list": { sessions: [{}], totalCount: 5 } });
    await render(withOne.engine);
    expect(host.querySelector(".prow b")?.textContent).toBe("Home");
    expect(host.querySelector(".prow small")?.textContent).toBe("5 conversations");
    expect(withOne.request).toHaveBeenCalledWith("sessions.list", { projectId: "home", limit: 1, excludeSubagents: true, excludeCron: true });
  });

  it("hides transient project errors and retries projects.list on Try again", async () => {
    const projectsList = vi.fn()
      .mockRejectedValueOnce(new Error("Session projection changed while preparing the listing. Retry the request."))
      .mockResolvedValueOnce({ projects: [{ id: "home", displayName: "Home", source: "registered" }] });
    const { engine, request } = engineOf({ "projects.list": projectsList });
    await render(engine);
    expect(host.textContent).not.toContain("Session projection");
    expect(host.textContent).toContain("Couldn’t read your projects just now.");
    const projects = host.querySelector('[data-sec="Projects"]')!;
    expect(projects.querySelector('[role="status"] .sdot.warn')).not.toBeNull();
    expect(projectsList).toHaveBeenCalledTimes(1);
    const retry = [...projects.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    expect(retry).toBeDefined();
    await act(async () => retry.click());
    expect(projectsList).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.filter(([method]) => method === "projects.list")).toEqual([
      ["projects.list", {}],
      ["projects.list", {}],
    ]);
    expect(projects.querySelector(".prow b")?.textContent).toBe("Home");
    expect(projects.querySelector('[role="status"]')).toBeNull();
  });

  it("When you send while it works saves messages.queue.mode", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await press("When you send while it works", "Wait in line");
    expect(patchOf(request)).toEqual({ messages: { queue: { mode: "followup" } } });
  });

  it("a person's own row saves through users.prefs.set", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await press("Send with", "Ctrl Enter");
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { [GENERAL_PREFS.sendWith]: "ctrl" } });
    expect(row("Send with").querySelector('[aria-pressed="true"]')?.textContent).toBe("Ctrl Enter");
    expect(row("Send with").textContent).toContain("Back to default");
  });

  it("without a person the own rows are greyed with why", async () => {
    const { engine } = engineOf({ "users.prefs.get": { status: "no_durable_identity" } });
    await render(engine, 1);
    expect(row("Vim keys in the message box").getAttribute("aria-disabled")).toBe("true");
    expect(row("Vim keys in the message box").textContent).toContain("Sign in as yourself");
  });

  it("summaries switch and number save their compaction keys, commas and all", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await act(async () => row("Summarise older turns by themselves").querySelector<HTMLInputElement>("input")!.click());
    expect(patchOf(request)).toEqual({ agents: { defaults: { compaction: { enabled: false } } } });
    const input = row("Always keep the latest").querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("20,000");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "30,000"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const last = request.mock.calls.filter(([m]) => m === "config.patch").pop() as unknown as [string, { raw: string }];
    expect(JSON.parse(last[1].raw)).toEqual({ agents: { defaults: { compaction: { keepRecentTokens: 30000 } } } });
  });

  it("Trim old tool results reads the engine's pruning and writes its mode", async () => {
    const { engine, request } = engineOf({ "models.authStatus": { providers: [{ provider: "anthropic", profiles: [{ profileId: "a" }] }] } }, { agents: { defaults: { contextPruning: { mode: "cache-ttl", ttl: "1h" } } } });
    await render(engine, 2);
    expect(row("Trim old tool results").textContent).toContain("Clears old tool output after the cache expires.");
    expect(row("Trim after").querySelector("input")!.value).toBe("60");
    await act(async () => row("Trim old tool results").querySelector<HTMLInputElement>("input")!.click());
    expect(patchOf(request)).toEqual({ agents: { defaults: { contextPruning: { mode: "off" } } } });
    expect(ttlMinutes(undefined)).toBe(5);
    expect(ttlMinutes("90s")).toBe(1.5);
  });

  it("desktop-only rows are greyed with a reason", async () => {
    const { engine } = engineOf();
    await render(engine, 1);
    // In a plain browser the Branch app's own rows are greyed and say where they are changed.
    for (const t of [`Start with ${platformName()}`]) {
      expect(row(t).getAttribute("aria-disabled")).toBe("true");
      expect(row(t).querySelector(".why-k")?.textContent).toBe(IN_BROWSER);
    }
    expect(row("Keep working when the window closes")).toBeNull();
    expect(host.querySelector(".status")).toBeNull();
  });

  it("Start with macOS says why it is greyed when the Branch app is too old to change it (DA-78)", async () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    // An older Branch app hands the window its gateway but not the startup controls.
    (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: "ws://127.0.0.1:1", gatewayToken: "t" };
    try {
      const { engine } = engineOf();
      await render(engine, 0);
      const start = row("Start with macOS");
      expect(start.getAttribute("aria-disabled")).toBe("true");
      expect(start.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
      expect(start.querySelector(".why-k")?.textContent).toBe("Update the Branch app on this computer to change this.");
      expect(start.textContent).toContain("Opens quietly in the tray.");
      expect(visibleDevNotes(host)).toEqual([]);
    } finally {
      delete (window as { branchDesktop?: unknown }).branchDesktop;
      delete (navigator as { platform?: string }).platform;
      if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
    }
  });

  it("keeps only startup controls in General", async () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    let state = { keepWorking: true, keepAwake: false, trayUsage: false, startWithWindows: false, branchOnPath: false };
    const set = vi.fn(async (name: keyof typeof state, on: boolean) => (state = { ...state, [name]: on }));
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    try {
      const { engine } = engineOf();
      await render(engine, 0);
      expect(row("Keep working when the window closes")).toBeNull();
      const start = () => row("Start with Windows").querySelector<HTMLInputElement>("input")!;
      expect(start().checked).toBe(false);
      expect(row("Start with Windows").getAttribute("aria-disabled")).toBeNull();
      await act(async () => start().click());
      expect(set).toHaveBeenCalledWith("startWithWindows", true);
      expect(start().checked).toBe(true);
    } finally {
      delete (window as { branchDesktop?: unknown }).branchDesktop;
      delete (navigator as { platform?: string }).platform;
      if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
    }
  });

  it("Starting up uses the real platform name, like setup", async () => {
    const { engine } = engineOf();
    const prev = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    const cases: [string, string, string][] = [
      ["Win32", "Start with Windows", "Start with macOS"],
      ["MacIntel", "Start with macOS", "Start with Windows"],
      ["Linux x86_64", "Start with Linux", "Start with Windows"],
    ];
    try {
      for (const [platform, title, absent] of cases) {
        Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => platform });
        await render(engine, 0);
        expect(row(title)).toBeTruthy();
        expect(host.textContent).not.toContain(absent);
      }
    } finally {
      if (prev) Object.defineProperty(Navigator.prototype, "platform", prev);
    }
  });

  it("When you send while it works has its pin while it follows the engine's default", async () => {
    const { engine } = engineOf();
    const pins: Pins = { page: "general", list: [], has: () => false, toggle: vi.fn(), go: vi.fn(), unpin: vi.fn() };
    await act(async () => root.render(<KitProvider level={1} report={report} scope={null} pins={pins}><GeneralPage page="general" title="General" level="advanced" engine={engine} /></KitProvider>));
    await act(async () => { await configStore(engine).load(); });
    expect(row("When you send while it works").querySelector('[aria-label="Pin When you send while it works"]')).not.toBeNull();
  });
});

describe("Settings › General › every control left on the page persists", () => {
  const prefsSaved = (request: ReturnType<typeof engineOf>["request"]) => request.mock.calls.filter(([m]) => m === "users.prefs.set").map(([, p]) => p);
  const patches = (request: ReturnType<typeof engineOf>["request"]) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));
  const toggle = async (title: string) => { await act(async () => row(title).querySelector<HTMLInputElement>("input")!.click()); };
  const setNumber = async (title: string, value: string) => {
    const input = row(title).querySelector<HTMLInputElement>("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  };
  const choose = async (title: string, value: string) => {
    const select = row(title).querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  it("the conversation's switches and choices save to the person's own prefs", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await press("Task progress starts", "Folded");
    await press("Message times", "Always");
    await toggle("Vim keys in the message box");
    await toggle("Task progress above the message box");
    expect(prefsSaved(request)).toEqual(expect.arrayContaining([
      { entries: { [GENERAL_PREFS.taskProgressStarts]: "folded" } },
      { entries: { [GENERAL_PREFS.messageTimes]: "always" } },
      { entries: { [GENERAL_PREFS.vimKeys]: true } },
      { entries: { [GENERAL_PREFS.taskProgress]: false } },
    ]));
  });

  it("Ask before deleting a conversation is kept on this device", async () => {
    const { engine } = engineOf();
    await render(engine, 1);
    await toggle("Ask before deleting a conversation");
    expect(localStorage.getItem("branch.askBeforeDelete")).toBe("0");
    await toggle("Ask before deleting a conversation");
    expect(localStorage.getItem("branch.askBeforeDelete")).toBeNull();
  });

  it("Show “Finish setting up” saves the person's look", async () => {
    const { engine, request } = engineOf();
    await render(engine, 0);
    await toggle("Show “Finish setting up”");
    expect(prefsSaved(request).some((p) => (p as { entries?: Record<string, { checklist?: boolean }> }).entries?.["ui.window.look"]?.checklist === false)).toBe(true);
  });

  it("older turns and the summary style save to the engine's compaction keys", async () => {
    const { engine, request } = engineOf({ "models.list": { models: [{ id: "m", provider: "ollama", name: "Local", available: true }] } });
    await render(engine, 2);
    await choose("Model for summaries", "ollama/m");
    await press("How it summarises", "Quick");
    await toggle("Keep names and numbers exact");
    await setNumber("Summary time limit", "240");
    await setNumber("Always keep the latest", "30000");
    const saved = patches(request);
    expect(saved).toContainEqual({ agents: { defaults: { compaction: { model: "ollama/m" } } } });
    expect(saved).toContainEqual({ agents: { defaults: { compaction: { mode: "default" } } } });
    expect(saved).toContainEqual({ agents: { defaults: { compaction: { identifierPolicy: "off" } } } });
    expect(saved).toContainEqual({ agents: { defaults: { compaction: { timeoutSeconds: 240 } } } });
    expect(saved).toContainEqual({ agents: { defaults: { compaction: { keepRecentTokens: 30000 } } } });
  });

  it("the waiting line's cap and full-line rule save to the queue keys", async () => {
    const { engine, request } = engineOf();
    await render(engine, 2);
    await setNumber("Most messages in line", "40");
    await press("When the line is full", "Drop the oldest");
    const saved = patches(request);
    expect(saved).toContainEqual({ messages: { queue: { cap: 40 } } });
    expect(saved).toContainEqual({ messages: { queue: { drop: "old" } } });
  });
});
