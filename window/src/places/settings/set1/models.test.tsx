// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { SettingsPage as ModelsAccountsPage } from "../index";
import { connectionsOf, modelsOf } from "./models-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const MODELS = { models: [
  { id: "gpt-5.5", provider: "openai", name: "GPT-5.5", available: true, input: ["text", "image"], thinkingLevels: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] },
  { id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5", available: true },
  { id: "qwen3:8b", provider: "ollama", name: "Qwen3 8B", local: true, available: true },
] };
const AUTH = { providers: [
  { provider: "openai", displayName: "OpenAI", status: "ok", profileOrder: ["openai:a"], profiles: [{ profileId: "openai:a", type: "oauth", status: "ok", email: "a@example.test" }] },
  { provider: "anthropic", displayName: "Anthropic", status: "ok", profiles: [{ profileId: "anthropic:b", type: "token", status: "ok" }] },
], providerCapabilities: [] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(config: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "models.list") return MODELS;
    if (method === "models.authStatus") return AUTH;
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.patch") return { ok: true, hash: "h2", config };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0, scope: string | null = null, page = "models") {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={scope}><ModelsAccountsPage page={page} title="Models" level="regular" engine={engine} /></KitProvider>));
}
const click = async (text: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!.click());
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));

describe("Settings › Models", () => {
  it("connections are the services with accounts, then this computer", () => {
    const conns = connectionsOf(modelsOf(MODELS), AUTH.providers as never);
    expect(conns.map((c) => [c.id, c.name, c.models.length])).toEqual([["openai", "ChatGPT", 1], ["anthropic", "Claude", 1], ["local", "This computer", 1]]);
  });

  it("keeps account order in the shared Accounts view, not a duplicate Connections tab", async () => {
    const { engine } = engineOf();
    await render(engine);
    await click("Accounts");
    expect(host.querySelector('[data-sec="Order Branch uses them in"]')?.textContent).toContain("ChatGPT");
    expect(host.querySelector('[data-sec="Order Branch uses them in"]')?.textContent).toContain("Claude");
    expect(host.querySelector('[role="tablist"]')?.textContent).not.toContain("Connections");
  });

  it("Everyday answers sets the default model to that connection's default", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine);
    await click("Default");
    const seg = host.querySelector('[aria-label="Everyday answers"]')!;
    await act(async () => [...seg.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "This computer")!.click());
    expect(patches(request)).toContainEqual({ agents: { defaults: { model: { primary: "ollama/qwen3:8b" } } } });
  });

  it("thinking is saved per model under a key that holds dots", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine);
    await click("Default");
    await act(async () => [...host.querySelector('[aria-label="ChatGPT thinking"]')!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Thorough")!.click());
    expect(patches(request)).toContainEqual({ agents: { defaults: { models: { "openai/gpt-5.5": { params: { thinking: "high" } } } } } });
  });

  it("Settings for a Trunk writes that Trunk's own model", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine, 1, "scout");
    await click("Default");
    const seg = host.querySelector('[aria-label="Everyday answers"]')!;
    await act(async () => [...seg.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Claude")!.click());
    expect(patches(request)).toContainEqual({ agents: { entries: { scout: { model: { primary: "anthropic/claude-opus-5" } } } } });
    expect(request).toHaveBeenCalledWith("models.list", { includeDetails: true, agentId: "scout" });
  });

  it("Advanced rows show only at Advanced; numbers save as numbers", async () => {
    const { engine, request } = engineOf();
    await render(engine, 0);
    expect(host.textContent).not.toContain("Sub-tasks at once");
    await render(engine, 1);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Sub-tasks at once"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "4"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(patches(request)).toContainEqual({ agents: { defaults: { subagents: { maxConcurrent: 4 } } } });
  });

  it("Trunk model choice switches save to the engine and read back after a reload", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    const sw = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    // Own-model changes start off; choosing the model at task start starts on (the engine's defaults).
    for (const [label, key, before] of [["Trunks may switch their own model", "enabled", false], ["Pick the model per task", "perTask", true]] as const) {
      expect(sw(label).disabled).toBe(false);
      expect(sw(label).checked).toBe(before);
      await act(async () => sw(label).click());
      expect(patches(request)).toContainEqual({ tools: { modelChoice: { [key]: !before } } });
    }
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(engineOf({ tools: { modelChoice: { enabled: true, perTask: false } } }).engine, 1);
    expect(sw("Trunks may switch their own model").checked).toBe(true);
    expect(sw("Pick the model per task").checked).toBe(false);
  });

  it.each([true, false])("model switching follows Settings off/on/off/on with full access %s", async (fullAccess) => {
    // Load the real policy at test runtime without pulling the engine's source
    // type graph into the window's separate TypeScript project.
    const policyModule = pathToFileURL(resolve(process.cwd(), "../engine/src/agents/model-choice.ts")).href;
    const { authorizeAgentModelChange, MODEL_CHOICE_OFF_MESSAGE } = await import(policyModule);
    const config = { tools: { modelChoice: { enabled: false, perTask: false } } };
    const { engine, request } = engineOf(config);
    // Persist the exact Settings payload, then pass it to the real engine policy.
    // Only the transport and the person's approval response are fixtures.
    const originalRequest = request.getMockImplementation()!;
    request.mockImplementation(async (method: string, ...args: unknown[]) => {
      if (method === "config.patch") {
        const patch = JSON.parse((args[0] as { raw: string }).raw);
        Object.assign(config.tools.modelChoice, patch.tools.modelChoice);
        return { ok: true, hash: "h2", config };
      }
      return originalRequest(method);
    });
    const requestApproval = vi.fn(async () => "allow" as const);
    const authorize = () => authorizeAgentModelChange({
      cfg: config, fullAccess, request: { model: "openai/gpt-5.5" }, requestApproval,
    });
    await render(engine, 1);
    const sw = () => host.querySelector<HTMLInputElement>('input[aria-label="Trunks may switch their own model"]')!;
    expect(sw().checked).toBe(false);
    await expect(authorize()).resolves.toEqual({ ok: false, reason: MODEL_CHOICE_OFF_MESSAGE });
    expect(requestApproval).not.toHaveBeenCalled();
    for (const enabled of [true, false, true]) {
      requestApproval.mockClear();
      await act(async () => sw().click());
      expect(sw().checked).toBe(enabled);
      expect(config.tools.modelChoice).toEqual({ enabled, perTask: false });
      await expect(authorize()).resolves.toEqual(enabled
        ? { ok: true }
        : { ok: false, reason: MODEL_CHOICE_OFF_MESSAGE });
      expect(requestApproval).toHaveBeenCalledTimes(enabled && !fullAccess ? 1 : 0);
    }
    expect(patches(request)).toEqual([true, false, true].map((enabled) => ({ tools: { modelChoice: { enabled } } })));
  });

  it("Technical shows one Per account heading with its sections together", async () => {
    const { engine } = engineOf();
    await render(engine, 2);
    const sections = [...host.querySelectorAll<HTMLElement>(".sec")];
    const first = sections.findIndex((s) => s.querySelector('[data-row="Service tier"]'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(sections[first + 1]?.querySelector('[data-row="OpenRouter picks"]')).not.toBeNull();
    expect([...host.querySelectorAll(".sec > h2")].filter((h) => h.textContent === "Per account")).toHaveLength(1);
  });

  it("with no account offers one Add an account action in Accounts", async () => {
    const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", valid: true, config: {} } : method === "models.authStatus" ? { providers: [] } : { models: [] });
    await render({ request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine);
    await click("Accounts");
    expect(host.textContent).toContain("No account signed in");
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Add an account")).toHaveLength(1);
    await click("Add an account");
    expect(document.querySelector('[data-testid="add-account"]')).not.toBeNull();
  });

  it("calls the unconfigured xAI service by its product name", async () => {
    const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", valid: true, config: {} } : method === "models.authStatus" ? {
      providers: [], providerCapabilities: [{ provider: "xai", loginOptions: [{ featured: true }] }],
    } : { models: [] });
    await render({ request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine);
    await click("Accounts");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Sign in to xAI");
  });
});


describe("DA-73 shared model setup", () => {
  it.each([null, "scout"])("keeps local model selection writable for scope %s", async (scope) => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine, 1, scope, "local");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Local");
    expect(host.querySelectorAll('[data-row="Qwen3 8B"]')).toHaveLength(1);
    await click("Use this");
    const owner = scope ? { entries: { scout: { model: { primary: "ollama/qwen3:8b" } } } } : { defaults: { model: { primary: "ollama/qwen3:8b" } } };
    expect(patches(request)).toContainEqual({ agents: owner });
  });

  it("keeps local model changes disabled for someone without setup permission", async () => {
    const { engine, request } = engineOf();
    await render({ ...engine, scopes: ["operator.read"] }, 0, null, "local");
    const use = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Use this")!;
    expect(use.disabled).toBe(true);
    await act(async () => use.click());
    expect(patches(request)).toEqual([]);
  });

  it("search opens the matching model view without taking an account row to Default", async () => {
    const { engine } = engineOf();
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><ModelsAccountsPage page="models" title="Models" level="regular" engine={engine} searchSection="Second opinion" /></KitProvider>));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Double-check");
    expect(host.querySelector('[data-row="Ask a second model on hard questions"]')).not.toBeNull();
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><ModelsAccountsPage page="accounts" title="Accounts" level="regular" engine={engine} searchSection="Order Branch uses them in" /></KitProvider>));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Accounts");
    expect(host.querySelector('[data-sec="Order Branch uses them in"]')).not.toBeNull();
  });
});
