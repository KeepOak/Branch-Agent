// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ModelsPage } from "./models";
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
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0, scope: string | null = null) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={scope}><ModelsPage page="models" title="Models" level="regular" engine={engine} /></KitProvider>));
}
const click = async (text: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!.click());
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));

describe("Settings › Models", () => {
  it("connections are the services with accounts, then this computer", () => {
    const conns = connectionsOf(modelsOf(MODELS), AUTH.providers as never);
    expect(conns.map((c) => [c.id, c.name, c.models.length])).toEqual([["openai", "ChatGPT", 1], ["anthropic", "Claude", 1], ["local", "This computer", 1]]);
  });

  it("Connections groups each service's accounts with who answers first", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect([...host.querySelectorAll(".acct-gh b")].map((b) => b.textContent)).toEqual(["ChatGPT", "Claude"]);
    expect(host.querySelector(".acct-r .pill.ok")?.textContent).toBe("Answers first");
  });

  it("Everyday answers sets the default model to that connection's default", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine);
    await click("Defaults");
    const seg = host.querySelector('[aria-label="Everyday answers"]')!;
    await act(async () => [...seg.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "This computer")!.click());
    expect(patches(request)).toContainEqual({ agents: { defaults: { model: { primary: "ollama/qwen3:8b" } } } });
  });

  it("thinking is saved per model under a key that holds dots", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine);
    await click("Defaults");
    await act(async () => [...host.querySelector('[aria-label="ChatGPT thinking"]')!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "High")!.click());
    expect(patches(request)).toContainEqual({ agents: { defaults: { models: { "openai/gpt-5.5": { params: { thinking: "high" } } } } } });
  });

  it("Settings for a Trunk writes that Trunk's own model", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine, 1, "scout");
    await click("Defaults");
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

  it("Technical shows one Per account heading with its sections together", async () => {
    const { engine } = engineOf();
    await render(engine, 2);
    const sections = [...host.querySelectorAll<HTMLElement>(".sec")];
    const first = sections.findIndex((s) => s.querySelector('[data-row="Service tier"]'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(sections[first + 1]?.querySelector('[data-row="OpenRouter picks"]')).not.toBeNull();
    expect([...host.querySelectorAll(".sec > h2")].filter((h) => h.textContent === "Per account")).toHaveLength(1);
  });

  it("with no account and no local model it says No model set up and offers Add an account", async () => {
    const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", valid: true, config: {} } : method === "models.authStatus" ? { providers: [] } : { models: [] });
    await render({ request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine);
    expect(host.textContent).toContain("No model set up");
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Add an account")).toHaveLength(1);
    await click("Add an account");
    expect(document.querySelector('[data-testid="add-account"]')).not.toBeNull();
  });

  it("calls the unconfigured xAI service by its product name", async () => {
    const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", valid: true, config: {} } : method === "models.authStatus" ? {
      providers: [], providerCapabilities: [{ provider: "xai", loginOptions: [{ featured: true }] }],
    } : { models: [] });
    await render({ request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine);
    expect(host.querySelector(".acct-gh > b")?.textContent).toBe("xAI");
    expect([...host.querySelectorAll(".acct-g .add-row")].map((b) => b.textContent)).toEqual(["Sign in to xAI"]);
  });
});
