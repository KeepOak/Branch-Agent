// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Thread } from "./Thread";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function backend() {
  const request = vi.fn().mockImplementation(async (method: string, params: object = {}) => {
    if (method === "sessions.list") return { sessions: Reflect.get(params, "spawnedBy") === "agent:main:main"
      ? [{ key: "agent:main:subagent:reader", spawnedBy: "agent:main:main", label: "Reader", status: "running", createdAt: 3_000 }] : [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.self") return { id: "observer" };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "session.context.set") return { messageId: Reflect.get(params, "messageId"), excluded: Reflect.get(params, "exclude") };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    if (method === "usage.status") return { providers: [] };
    throw new Error(`Unexpected method ${method}`);
  });
  const engine: WindowEngine = { request, sessionKey: "agent:main:main", scopes: [], onEvent: () => () => {} };
  return { engine, request };
}

describe("actual thread compact helper entry", () => {
  it("opens full Activity through the task-anchored chip without navigating or stopping the conversation", async () => {
    const fixture = backend();
    const activity = vi.fn(), openSession = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Thread name="Owner" history={[{ kind: "user", key: "message", text: "Existing words", meta: { timestamp: 1_000 } },
      { kind: "text", key: "reply", text: "Helpers are working", streaming: false, meta: { timestamp: 2_000 } },
      { kind: "user", key: "later", text: "Unrelated question", meta: { timestamp: 4_000 } }]} live={[]} pendingUser={null} running={false}
      engine={fixture.engine} onAnswer={() => {}} onOpenActivity={activity} onOpenSession={openSession} />));
    const chip = container.querySelector<HTMLButtonElement>('[data-testid="helpers-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("1 helper");
    expect(container.textContent!.indexOf("1 helper")).toBeLessThan(container.textContent!.indexOf("Unrelated question"));
    expect(container.querySelector('[data-testid="helpers-tree"]')).toBeNull();
    expect(chip?.getAttribute("aria-expanded")).toBeNull();
    await act(async () => chip!.click());
    expect(activity).toHaveBeenCalledOnce();
    expect(openSession).not.toHaveBeenCalled();
    expect(fixture.request.mock.calls.some(([method]) => method === "sessions.abort")).toBe(false);
    expect(container.textContent).toContain("Existing words");
  });
});

describe("message context control", () => {
  it("puts a message back immediately and offers an undo", async () => {
    const fixture = backend();
    const reload = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Thread name="Owner" history={[{ kind: "user", key: "message", text: "Earlier words", meta: { entryId: "entry-1", excluded: true } }]}
      live={[]} pendingUser={null} running={false} engine={fixture.engine} onAnswer={() => {}} onReload={reload} />));
    await act(async () => container.querySelector<HTMLButtonElement>(".context-line button")?.click());
    expect(fixture.request).toHaveBeenCalledWith("session.context.set", { sessionKey: "agent:main:main", messageId: "entry-1", exclude: false });
    expect(reload).toHaveBeenCalledOnce();
    expect(container.querySelector(".context-undo")?.textContent).toContain("Back in context. Undo");
    await act(async () => container.querySelector<HTMLButtonElement>(".context-undo button")?.click());
    expect(fixture.request).toHaveBeenLastCalledWith("session.context.set", { sessionKey: "agent:main:main", messageId: "entry-1", exclude: true });
  });
});
