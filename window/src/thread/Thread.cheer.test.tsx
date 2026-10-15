// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { RunEnd } from "../connect/session";
import type { Block } from "./model";
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

function backend(): WindowEngine {
  const request = vi.fn().mockImplementation(async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.self") return { id: "observer" };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    if (method === "usage.status") return { providers: [] };
    return {};
  });
  return { request, sessionKey: "agent:main:main", scopes: [], onEvent: () => () => {} } as unknown as WindowEngine;
}

const history: Block[] = [
  { kind: "user", key: "u1", text: "a" },
  { kind: "step", key: "s1", tool: "bash", title: "ls", detail: "", status: "ok" },
  { kind: "done", key: "r1:done", runId: "r1", durationMs: 90_000 },
];

describe("the done cheer on the thread", () => {
  const thread = (ended: RunEnd | null, cheerOn?: boolean) => (
    <Thread name="Juniper" history={history} live={[]} pendingUser={null} running={false} engine={backend()} onAnswer={() => {}} ended={ended} cheerOn={cheerOn} />
  );

  async function finishRun(cheerOn?: boolean) {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(thread(null, cheerOn)));
    await act(async () => root!.render(thread({ runId: "r1", outcome: "done", at: 1 }, cheerOn)));
    return host;
  }

  it("is not rendered by default", async () => {
    const host = await finishRun();
    expect(host.querySelector('[data-testid="done-cheer"]')).toBeNull();
  });

  it("is rendered once the person turns it on", async () => {
    const host = await finishRun(true);
    expect(host.querySelector('[data-testid="done-cheer"]')?.textContent).toContain("Juniper is done");
  });
});
