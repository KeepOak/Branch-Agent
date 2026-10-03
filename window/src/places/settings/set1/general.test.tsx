// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { configStore } from "../config-store";
import { GENERAL_ROWS, GeneralPage } from "./general";
import { GENERAL_PREFS } from "./general-conversation";
import { ttlMinutes } from "./general-summaries";

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
const heads = () => [...host.querySelectorAll(".sec > h2")].map((h) => h.textContent);
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const patchOf = (request: ReturnType<typeof engineOf>["request"]) => {
  const call = request.mock.calls.find(([m]) => m === "config.patch") as unknown as [string, { raw: string }];
  return JSON.parse(call[1].raw);
};
async function press(title: string, label: string) {
  await act(async () => [...row(title).querySelectorAll("button")].find((b) => b.textContent === label)!.click());
}

describe("Settings › General", () => {
  it("shows the preview's sections at each level", async () => {
    const { engine } = engineOf();
    await render(engine, 0);
    expect(heads()).toEqual(["Starting up", "Projects", "Keyboard", "Writing", "Cover the screen"]);
    await render(engine, 1);
    expect(heads()).toEqual(["Starting up", "Projects", "Keyboard", "Writing", "Clipboard history", "Cover the screen", "Controllers", "The conversation", "Summaries of older turns", "This PC"]);
    await render(engine, 2);
    expect(heads()).toEqual(["Starting up", "Projects", "Keyboard", "Writing", "Clipboard history", "Cover the screen", "Controllers", "The conversation", "Summaries of older turns", "Summaries, technical", "This PC", "Waiting line", "Summaries, more"]);
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
    expect(row("Trim old tool results").textContent).toContain("On because a Claude account is connected.");
    expect(row("Trim after").querySelector("input")!.value).toBe("60");
    await act(async () => row("Trim old tool results").querySelector<HTMLInputElement>("input")!.click());
    expect(patchOf(request)).toEqual({ agents: { defaults: { contextPruning: { mode: "off" } } } });
    expect(ttlMinutes(undefined)).toBe(5);
    expect(ttlMinutes("90s")).toBe(1.5);
  });

  it("desktop-only rows are greyed with a reason", async () => {
    const { engine } = engineOf();
    await render(engine, 1);
    for (const t of ["Start with Windows", "Quick ask from anywhere", "Cover now"]) {
      expect(row(t).getAttribute("aria-disabled")).toBe("true");
      expect(row(t).querySelector(".why-k")?.textContent).toMatch(/window can’t/);
    }
  });
});
