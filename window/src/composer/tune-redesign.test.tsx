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

async function mount(lockdown = false) {
  let row: Record<string, unknown> = { model: "openai/test", permissionMode: "ask", estimatedCostUsd: 0.5 };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "agents.list") return { defaultId: "research", agents: [{ id: "research", name: "Research" }] };
    if (method === "sessions.describe") return { session: { ...row } };
    if (method === "sessions.usage") return { totals: { totalCost: 0.75 } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true }, { id: "gpt-6.1-sol", provider: "openai", name: "GPT-6.1-Sol", available: true }] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "sessions.patch") {
      row = { ...row, ...params };
      return {};
    }
    if (method === "sessions.create") return { key: "agent:research:job" };
    if (method === "sessions.fork") return { sessionKey: "agent:research:fork" };
    return {};
  });
  const engine: WindowEngine = { sessionKey: "agent:research:main", agentId: "research", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] };
  const opened = vi.fn();
  const conversation = vi.fn();
  const toggleLockdown = vi.fn();
  const send = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Research" working={false} disabled={false} onSend={send} onStop={() => {}} engine={engine} onOpen={opened} onOpenConversation={conversation} lastUserEntryId="entry-1" lockdown={lockdown} onToggleLockdown={toggleLockdown} />));
  return { host, request, opened, conversation, toggleLockdown, send };
}

describe("P54 one composer symbol", () => {
  it("shows one tune symbol and Model, Access, Thread, Status and Usage in its popover", async () => {
    const { host, request } = await mount();
    expect(host.querySelectorAll('[data-testid="tune-button"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="model-chip"], [data-testid="mode-chip"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')?.click());
    expect([...host.querySelectorAll(".c-tune-section h3")].map((x) => x.textContent)).toEqual(["Model", "Access", "Thread", "Status", "Usage"]);
    expect(host.textContent).toContain("$0.75 in this conversation");
    expect(host.textContent).not.toContain("$0.50 in this conversation");
    expect(request).toHaveBeenCalledWith("sessions.usage", { key: "agent:research:main", range: "all" });
  });

  it("starts the next typed message as an engine-backed background job", async () => {
    const { host, request } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')?.click());
    const toggle = [...host.querySelectorAll<HTMLButtonElement>(".c-tune-line button")].find((b) => b.textContent === "Off");
    await act(async () => toggle?.click());
    await act(async () => {
      const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Check the report");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('.send')?.click());
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(true);
  });

  it("keeps Branch out of the model popover: each message's Branch in the hover bar makes the copy", async () => {
    const { host, request } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')?.click());
    expect([...host.querySelectorAll<HTMLButtonElement>(".c-tune-line button")].some((b) => b.textContent === "Branch")).toBe(false);
    expect(request).not.toHaveBeenCalledWith("sessions.fork", expect.anything());
  });

  it("updates the model label after a pick and returns access to As set", async () => {
    const { host, request } = await mount();
    const tune = host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')!;
    await act(async () => tune.click());
    const model = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="model-option"]')].find((button) => button.textContent?.includes("GPT-6.1 Sol"))!;
    await act(async () => model.click());
    expect(tune.getAttribute("aria-label")).toContain("GPT-6.1 Sol");
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:research:main", model: "openai/gpt-6.1-sol", thinkingLevel: null });
    await act(async () => tune.click());
    await act(async () => tune.click());
    const asSet = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="mode-option"]')].find((button) => button.textContent?.includes("As set"))!;
    await act(async () => asSet.click());
    expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:research:main", permissionMode: null });
    await act(async () => tune.click());
    expect(host.querySelector('[data-testid="mode-option"][aria-checked="true"]')?.textContent).toContain("As set");
  });

  it("shows Lockdown, disables modes, and refuses command submission", async () => {
    const { host, request, send, toggleLockdown } = await mount(true);
    const tune = host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')!;
    expect(tune.textContent).toContain("Lockdown");
    await act(async () => tune.click());
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-testid="mode-option"]')].every((button) => button.disabled)).toBe(true);
    const lockSwitch = host.querySelector<HTMLButtonElement>('[aria-label="Lockdown"]');
    await act(async () => lockSwitch?.click());
    expect(toggleLockdown).toHaveBeenCalledOnce();
    await act(async () => {
      const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "!echo hi");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(host.textContent).toContain("Lockdown is on: commands can't run.");
    expect(send).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([method]) => method === "sessions.patch")).toBe(false);
  });
});
