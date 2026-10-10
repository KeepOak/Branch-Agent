// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function mount(models: unknown[] = []) {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" }, model: { primary: "openai/gpt-6-astra" } }] };
    if (method === "sessions.describe") return { session: { model: "openai/gpt-6-astra", thinkingLevel: "medium" } };
    if (method === "sessions.list") return { defaults: { model: "openai/gpt-6-astra", modelProvider: "openai", thinkingDefault: "medium" }, sessions: [] };
    if (method === "models.list") return { models };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "sessions.usage") return { totals: {} };
    return {};
  });
  const engine: WindowEngine = {
    sessionKey: "agent:main:empty",
    agentId: "main",
    request: request as unknown as WindowEngine["request"],
    onEvent: () => () => undefined,
    scopes: [],
  };
  const onOpen = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Oak" working={false} disabled={false} onSend={vi.fn()} onStop={vi.fn()} engine={engine} onOpen={onOpen} />));
  return { host, onOpen };
}

describe("composer chip with no connected model", () => {
  it("does not put a model name on the chip when models.list is empty", async () => {
    const { host, onOpen } = await mount();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')).not.toBeNull());
    const tune = host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')!;
    expect(tune).toBeTruthy();
    expect(tune.getAttribute("aria-label")).toContain("No model");
    expect(tune.getAttribute("aria-label")).not.toMatch(/gpt-6-astra|GPT-6 Astra/i);
    expect(tune.getAttribute("title")).toContain("No model");
    expect(tune.getAttribute("title")).not.toMatch(/gpt-6-astra|openai\//i);
    await act(async () => tune.click());
    expect(host.textContent).toContain("No model account connected yet.");
    expect(host.textContent).toContain("Runs on no model");
    expect(host.textContent).not.toContain("No models are allowed here.");
    expect(host.textContent).not.toContain("This model has one speed.");
    const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add an account");
    expect(add).toBeTruthy();
    await act(async () => add?.click());
    expect(onOpen).toHaveBeenCalledWith("settings/accounts/add");
  });

  it("still names a connected model on the chip", async () => {
    const { host } = await mount([{ id: "gpt-6-astra", provider: "openai", name: "gpt-6-astra", available: true }]);
    await vi.waitFor(() => {
      const tune = host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]');
      expect(tune?.getAttribute("aria-label")).toContain("GPT-6 Astra");
    });
    const tune = host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')!;
    expect(tune.getAttribute("aria-label")).toContain("medium");
    expect(tune.getAttribute("aria-label")).not.toContain("No model");
    expect(host.querySelector('[data-testid="no-model"]')).toBeNull();
  });
});
