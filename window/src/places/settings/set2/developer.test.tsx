// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";
import { ROWS, codeModeWith, execLine, toolSearchOn } from "./developer";
import { runsFrom, warningsOf } from "./developer-more";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a === undefined) return {};
    if (a instanceof Error) throw a;
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine) {
  await act(async () => root.render(<SettingsPage page="developer" title="Developer" level="technical" engine={engine} />));
  await flush();
}
const buttons = (text: string) => [...document.querySelectorAll("button")].filter((x) => x.textContent?.trim() === text || x.getAttribute("aria-label") === text) as HTMLButtonElement[];
async function click(el: HTMLElement) { await act(async () => el.click()); await flush(); }
const row = (title: string) => document.querySelector(`[data-row="${title}"]`) as HTMLElement | null;
const patches = (request: ReturnType<typeof engineWith>["request"]) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse(String((p as { raw: string }).raw)));
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}

const CONFIG = (config: Record<string, unknown> = {}) => ({ "config.get": { hash: "h1", valid: true, path: "/home/me/.branch/branch.json", raw: "{\n  gateway: { auth: { token: \"__BRANCH_REDACTED__\" } }\n}", config }, "config.patch": { ok: true } });

describe("Settings › Developer", () => {
  it("shows the local address from the configured port and this computer's identity", async () => {
    const { engine } = engineWith({ ...CONFIG({ gateway: { port: 19001 } }), "gateway.identity.get": { deviceId: "dev-abc", publicKey: "pk-xyz" } });
    await show(engine);
    expect(row("Local address")?.textContent).toContain("127.0.0.1:19001");
    expect(row("Device ID")?.textContent).toContain("dev-abc");
    expect(row("Public key")?.textContent).toContain("pk-xyz");
    expect(row("Point the page at another Gateway")?.textContent).toContain("http://127.0.0.1:19001/?gatewayUrl=");
  });

  it("shows the engine's error when the identity can't be read", async () => {
    const { engine } = engineWith({ ...CONFIG(), "gateway.identity.get": new Error("identity store locked") });
    await show(engine);
    expect(row("Device ID")?.textContent).toContain("identity store locked");
  });

  it("builds the failed sign-in line from the rate limit, with the engine's defaults", async () => {
    const { engine } = engineWith(CONFIG({ gateway: { auth: { rateLimit: { maxAttempts: 4, lockoutMs: 120_000 } } } }));
    await show(engine);
    expect(row("Failed sign-ins")?.textContent).toContain("4 tries a minute, then a 2-minute wait. This computer isn’t counted.");
  });

  it("saves sign-in, Settings over HTTP and the HTTP doors to their config keys", async () => {
    const { engine, request } = engineWith(CONFIG());
    await show(engine);
    await click(buttons("Password")[0]);
    await click(row("Settings over HTTP")!.querySelector("input")!);
    await click(row("Answer like the OpenAI Responses API")!.querySelector("input")!);
    await click(row("A chat address other apps understand")!.querySelector("input")!);
    const all = patches(request);
    expect(all).toContainEqual({ gateway: { auth: { mode: "password" } } });
    expect(all).toContainEqual({ plugins: { entries: { "admin-http-rpc": { enabled: true } } } });
    expect(all).toContainEqual({ gateway: { http: { endpoints: { responses: { enabled: true } } } } });
    expect(all).toContainEqual({ gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } } });
  });

  it("keeps whether code mode is on when choosing where it runs, and reads tool search like the engine", async () => {
    expect(codeModeWith(undefined, "quickjs")).toEqual({ enabled: "auto", executor: "quickjs" });
    expect(codeModeWith(false, "quickjs")).toEqual({ enabled: false, executor: "quickjs" });
    expect(codeModeWith({ enabled: true, timeoutMs: 5 }, "node")).toEqual({ enabled: true, timeoutMs: 5, executor: "node" });
    expect(toolSearchOn(undefined)).toBe(true);
    expect(toolSearchOn({ mode: "directory" })).toBe(true);
    expect(toolSearchOn({})).toBe(false);
    const { engine, request } = engineWith(CONFIG({ tools: { codeMode: true } }));
    await show(engine);
    const pick = row("Run code mode in")!.querySelector("select")!;
    await act(async () => { pick.value = "quickjs"; pick.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(patches(request)).toContainEqual({ tools: { codeMode: { enabled: true, executor: "quickjs" } } });
  });

  it("greys rows the engine has nothing for, without the developer note", async () => {
    const { engine } = engineWith(CONFIG());
    await show(engine);
    const r = row("Use language servers");
    expect(r?.getAttribute("aria-disabled")).toBe("true"); expect(r?.querySelector(".right")?.hasAttribute("inert")).toBe(true);
    expect(r?.textContent).not.toContain("Needs the engine"); expect(r?.querySelector(".why-k")).toBeNull();
    expect(visibleDevNotes(document.body)).toEqual([]);
    expect(row("Look at a project’s code")?.textContent).toContain("no code map yet");
  });

  it("builds the run-without-the-window line from agent exec's real flags", async () => {
    expect(execLine({ msg: "Say \"hi\"", model: "openai/gpt-5", cwd: "", stdin: false })).toBe("branch agent exec \"Say \\\"hi\\\"\" --model openai/gpt-5");
    expect(execLine({ msg: "", model: "", cwd: "./repo", stdin: true })).toBe("branch agent exec --message-file - --cwd \"./repo\"");
    const { engine } = engineWith(CONFIG());
    await show(engine);
    expect(document.querySelector(".s2developer-cmd code")?.textContent).toBe("branch agent exec \"‹message›\"");
    expect(document.querySelector('[title^="agent exec prints one JSON result"] input')?.hasAttribute("disabled")).toBe(true);
    await type(document.querySelector('input[aria-label="Message"]') as HTMLInputElement, "Check the build");
    expect(document.querySelector(".s2developer-cmd code")?.textContent).toBe("branch agent exec \"Check the build\"");
  });

  it("saves the settings file text with config.apply against its hash, and shows the engine's refusal", async () => {
    const { engine, request } = engineWith({ ...CONFIG({ gateway: {} }), "config.apply": () => { throw new Error("invalid config: gateway.port: Expected number"); } });
    await show(engine);
    await click(buttons("Open the editor")[0]);
    await click(buttons("Text")[0]);
    expect(document.querySelector(".dlg")?.textContent).toContain("1 hidden value stays hidden");
    const area = document.querySelector('textarea[aria-label="Settings file"]') as HTMLTextAreaElement;
    await type(area, "{ gateway: { port: \"x\" } }");
    await click(buttons("Save")[0]);
    const call = request.mock.calls.find(([m]) => m === "config.apply");
    expect(call?.[1]).toMatchObject({ raw: "{ gateway: { port: \"x\" } }", baseHash: "h1" });
    expect(document.querySelector(".dlg [role=alert]")?.textContent).toContain("Expected number");
  });

  it("lists recorded runs with their tool steps in the trace explorer", async () => {
    const ev = (o: Record<string, unknown>) => ({ eventId: `e${String(o.sequence)}`, sourceSequence: o.sequence, actor: { type: "agent", id: "main" }, agentId: "main", runId: "r1", redaction: "metadata_only", ...o });
    const events = [
      ev({ sequence: 1, occurredAt: 1000, kind: "agent_run", action: "agent.run.started", status: "started" }),
      ev({ sequence: 2, occurredAt: 2000, kind: "tool_action", action: "tool.action.started", status: "started", toolName: "exec", toolCallId: "c1" }),
      ev({ sequence: 3, occurredAt: 5000, kind: "tool_action", action: "tool.action.finished", status: "failed", toolName: "exec", toolCallId: "c1", errorCode: "tool_failed" }),
      ev({ sequence: 4, occurredAt: 9000, kind: "agent_run", action: "agent.run.finished", status: "failed", errorCode: "run_failed" }),
    ];
    const runs = runsFrom(events);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "failed", start: 1000, end: 9000 });
    expect(runs[0].steps[0]).toMatchObject({ name: "exec", start: 2000, end: 5000, status: "failed", error: "tool_failed" });
    const { engine, request } = engineWith({ ...CONFIG(), "audit.list": { events } });
    await show(engine);
    await click(buttons("Open")[0]);
    expect(request.mock.calls.some(([m]) => m === "audit.list")).toBe(true);
    const dlg = document.querySelector(".dlg")!;
    expect(dlg.textContent).toContain("Run · main");
    expect(dlg.textContent).toContain("exec");
    expect(dlg.textContent).toContain("Failed");
  });

  it("counts warnings from diagnostics.stability", async () => {
    expect(warningsOf([{ type: "model.call", outcome: "ok" }, { type: "tool.execution", timedOut: true }, { type: "channel.x", errorCategory: "network" }])).toHaveLength(2);
    const { engine } = engineWith({ ...CONFIG(), "diagnostics.stability": { events: [{ seq: 3, ts: 1, type: "channel.connection", outcome: "error" }] } });
    await show(engine);
    expect(row("Warnings since the start")?.textContent).toContain("1 kept");
  });

  it("calls a gateway action only with valid JSON values", async () => {
    const { engine, request } = engineWith({ ...CONFIG(), health: { ok: true } });
    await show(engine);
    await click(row("Call the gateway")!.querySelector("button")!);
    await type(document.getElementById("s2dev-act") as HTMLInputElement, "health");
    await type(document.getElementById("s2dev-vals") as HTMLTextAreaElement, "{bad");
    expect(buttons("Call")[0].disabled).toBe(true);
    await type(document.getElementById("s2dev-vals") as HTMLTextAreaElement, "{\"probe\":true}");
    await click(buttons("Call")[0]);
    expect(request).toHaveBeenCalledWith("health", { probe: true });
    expect(document.querySelector(".dlg pre")?.textContent).toContain("\"ok\": true");
  });

  it("lists every row for the settings search as a Technical row of this page", () => {
    expect(ROWS.length).toBeGreaterThan(150);
    expect(ROWS.every((r) => r.page === "developer" && r.lv === 2)).toBe(true);
    expect(ROWS.some((r) => r.title === "Device ID" && r.sec === "Local address")).toBe(true);
  });

  it("enables Run setup again and restarts the setup flow", async () => {
    const { engine } = engineWith(CONFIG());
    await show(engine);
    const btn = buttons("Run setup again")[0];
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    const seen = vi.fn();
    addEventListener("branch:run-setup-again", seen);
    await click(btn);
    expect(seen).toHaveBeenCalled();
    removeEventListener("branch:run-setup-again", seen);
  });
});
