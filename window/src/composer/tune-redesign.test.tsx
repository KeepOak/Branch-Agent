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

async function mount(options?: { model?: string; patch?: () => Promise<unknown> }) {
  let model = options?.model ?? "openai/test";
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "research", agents: [{ id: "research", name: "Research" }] };
    if (method === "sessions.describe") return { session: { modelOverride: model.split("/").slice(1).join("/"), providerOverride: model.split("/")[0], permissionMode: "ask", estimatedCostUsd: 0.5 } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true }, { id: "gpt-6.1-sol", provider: "openai-codex", name: "GPT-6.1-Sol", available: true }, { id: "local", provider: "llama-cpp", name: "Local", available: true, local: true }] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "sessions.patch") { await options?.patch?.(); model = "openai-codex/gpt-6.1-sol"; return {}; }
    if (method === "sessions.create") return { key: "agent:research:job" };
    if (method === "sessions.fork") return { sessionKey: "agent:research:fork" };
    return {};
  });
  const engine: WindowEngine = { sessionKey: "agent:research:main", agentId: "research", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] };
  const opened = vi.fn();
  const conversation = vi.fn();
  const sent = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Research" working={false} disabled={false} onSend={sent} onStop={() => {}} engine={engine} onOpen={opened} onOpenConversation={conversation} lastUserEntryId="entry-1" />));
  return { host, request, opened, conversation, sent };
}

describe("P54 one composer symbol", () => {
  it("does not send the previous local model while a picked model is being saved", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const { host, request, sent } = await mount({ model: "llama-cpp/local", patch: () => pending });
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')!.click());
    const choice = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="model-option"]')].find((b) => b.textContent?.includes("GPT-6.1-Sol"))!;
    await act(async () => choice.click());
    await act(async () => {
      const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Use the picked model");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector<HTMLButtonElement>('.send')?.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(sent).not.toHaveBeenCalled();
    await act(async () => release());
    expect(request).toHaveBeenCalledWith("sessions.patch", expect.objectContaining({ model: "openai-codex/gpt-6.1-sol" }));
    expect(host.querySelector<HTMLButtonElement>('.send')?.disabled).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('.send')!.click());
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it("shows one tune symbol and Model, Access, Thread, Status and Usage in its popover", async () => {
    const { host } = await mount();
    expect(host.querySelectorAll('[data-testid="tune-button"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="model-chip"], [data-testid="mode-chip"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')?.click());
    expect([...host.querySelectorAll(".c-tune-section h3")].map((x) => x.textContent)).toEqual(["Model", "Access", "Thread", "Status", "Usage"]);
    expect(host.textContent).toContain("$0.50 in this conversation");
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

  it("branches from a real message id and opens the new conversation", async () => {
    const { host, request, conversation } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="tune-button"]')?.click());
    const branch = [...host.querySelectorAll<HTMLButtonElement>(".c-tune-line button")].find((b) => b.textContent === "Branch");
    await act(async () => branch?.click());
    expect(request).toHaveBeenCalledWith("sessions.fork", { sessionKey: "agent:research:main", entryId: "entry-1" });
    expect(conversation).toHaveBeenCalledWith("agent:research:fork");
  });
});
