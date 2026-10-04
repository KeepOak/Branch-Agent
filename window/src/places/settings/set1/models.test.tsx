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

  it("Look discovers candidates without activating one and focuses Test and use", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") return MODELS;
      if (method === "models.authStatus") return AUTH;
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "branch.setup.detect") return { candidates: [{ kind: "ollama", modelRef: "ollama/qwen3:8b", label: "Qwen3 8B", credentials: true }] };
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    await render(engine);
    await click("Look");
    const dialog = document.querySelector('[data-testid="add-account"]')!;
    expect(dialog.textContent).toContain("Branch looks for accounts, coding apps and local models");
    expect(dialog.textContent).toContain("Qwen3 8B");
    expect(document.activeElement?.textContent).toBe("Test and use");
    expect(request).toHaveBeenCalledWith("branch.setup.detect", {});
    expect(request.mock.calls.some(([method]) => method === "branch.setup.activate.start")).toBe(false);
  });

  it("keeps focus in search when discovery arrives after interaction", async () => {
    let resolveDetect!: (value: unknown) => void;
    const detected = new Promise((resolve) => { resolveDetect = resolve; });
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") return MODELS;
      if (method === "models.authStatus") return AUTH;
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "branch.setup.detect") return detected;
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    await render(engine);
    await click("Look");
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search services"]')!;
    await act(async () => { search.focus(); search.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true })); });
    await act(async () => resolveDetect({ candidates: [{ kind: "ollama", modelRef: "ollama/qwen3:8b", label: "Qwen3 8B" }] }));
    expect(document.activeElement).toBe(search);
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).toContain("Test and use");
  });

  it("keeps local catalogue failure distinct from an empty computer and retries", async () => {
    let failed = true;
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") {
        if (failed) throw new Error("Local catalogue unavailable");
        return MODELS;
      }
      if (method === "models.authStatus") return AUTH;
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    await render(engine);
    await click("On this computer");
    expect(host.textContent).toContain("Branch couldn’t read models on this computer");
    expect(host.textContent).not.toContain("No model on this computer yet");
    failed = false;
    await click("Try again");
    expect(host.textContent).toContain("Qwen3 8B is ready on this computer");
    expect(host.textContent).not.toContain("Local catalogue unavailable");
  });

  it("Everyday answers sets the default model to that connection's default", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } });
    await render(engine);
    await click("Defaults");
    const seg = host.querySelector('[aria-label="Everyday answers"]')!;
    await act(async () => [...seg.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "This computer")!.click());
    expect(patches(request)).toContainEqual({ agents: { defaults: { model: { primary: "ollama/qwen3:8b" } } } });
  });

  it("Don’t switch clears every fallback rather than promoting the next one", async () => {
    const { engine, request } = engineOf({ agents: { defaults: { model: { primary: "openai/gpt-5.5", fallbacks: ["anthropic/claude-opus-5", "ollama/qwen3:8b"] } } } });
    await render(engine);
    await click("Defaults");
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="If the model fails"]')!;
    await act(async () => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(patches(request)).toContainEqual({ agents: { defaults: { model: { fallbacks: [] } } } });
  });

  it("keeps a nickname draft after failed save and clears it only after retry", async () => {
    let fail = true;
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") return MODELS;
      if (method === "models.authStatus") return AUTH;
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "config.patch" && fail) throw new Error("Settings unavailable");
      if (method === "config.patch") return { ok: true, hash: "h2", config: {} };
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    await render(engine, 2);
    await click("Defaults");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Nickname"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "workhorse"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Add");
    expect(input.value).toBe("workhorse");
    expect(report.failed).toHaveBeenCalledWith("Settings unavailable");
    fail = false;
    await click("Add");
    expect(input.value).toBe("");
    expect(patches(request)).toContainEqual({ agents: { defaults: { models: { "openai/gpt-5.5": { alias: "workhorse" } } } } });
  });

  it("locks the nickname draft and model while a save is pending", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") return MODELS;
      if (method === "models.authStatus") return AUTH;
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "config.patch") { await pending; return { ok: true, hash: "h2", config: {} }; }
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    await render(engine, 2);
    await click("Defaults");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Nickname"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "workhorse"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add")!;
    await act(async () => { add.click(); add.click(); });
    expect(input.disabled).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Model for the nickname"]')!.disabled).toBe(true);
    expect(request.mock.calls.filter(([method]) => method === "config.patch")).toHaveLength(1);
    await act(async () => finish());
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("");
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

  it("with no account and no local model it says No model set up and offers Add an account", async () => {
    const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", valid: true, config: {} } : method === "models.authStatus" ? { providers: [] } : { models: [] });
    await render({ request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine);
    expect(host.textContent).toContain("No model set up");
    await click("Add an account");
    expect(document.querySelector('[data-testid="add-account"]')).not.toBeNull();
  });
});
