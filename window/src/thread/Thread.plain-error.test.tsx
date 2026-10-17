// @vitest-environment jsdom
// Thread retry, earlier pages, step detail and error toasts: one plain sentence at Regular, exact words at Advanced.
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Thread } from "./Thread";
import type { Block } from "./model";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status|ENOENT|\/home\/|TypeError|runTool/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const RESTART = "Interrupted by a restart. Continue?";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function engineOf(request: WindowEngine["request"], key = "agent:main:main"): WindowEngine {
  return { request, sessionKey: key, scopes: [], onEvent: () => () => {} };
}

const quiet = async (method: string, params: Record<string, unknown> = {}) => {
  if (method === "users.prefs.get") return { status: "ok", entries: {} };
  if (method === "users.self") return { id: "observer" };
  if (method === "session.reactions.list") return { reactions: {} };
  if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
  if (method === "sessions.list") return { sessions: [] };
  if (method === "usage.status") return { providers: [] };
  if (method === "agents.list") return { agents: [] };
  throw new Error(`Unexpected method ${method} ${JSON.stringify(params)}`);
};

const draw = (props: Partial<ComponentProps<typeof Thread>> = {}) =>
  act(async () => root.render(<Thread name="Scout" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} {...props} />));

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

describe("the thread never shows a raw engine error at Regular", () => {
  it("names a failed earlier-pages load in a plain sentence", async () => {
    await draw({ earlierError: ENGINE });
    const line = host.querySelector(".stamp[role='status']")?.textContent ?? "";
    expect(line).toBe(`Couldn't load earlier pages. ${REACH}`);
    expect(line).not.toMatch(RAW);
  });

  it("names a failed earlier-page step in a plain sentence", async () => {
    const step: Block = { kind: "step", key: "s1", tool: "read", title: "Read a file", detail: "ENOENT: no such file or directory, open '/home/alex/notes/plan.md'", status: "failed" };
    await draw({ earlierPages: [{ sessionId: "old", blocks: [step] }] });
    const line = host.querySelector(".segment-line")?.textContent ?? "";
    expect(line).toContain("Read a file");
    expect(line).toContain("That file or folder isn’t there. Check that it still exists, then try again.");
    expect(line).not.toMatch(RAW);
  });

  it("names a failed startup retry in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "main", admissionRefusal: { code: "agent-database-inspection-pending", preparation: { state: "needs-attention" } } }] };
      if (method === "agents.retryStartup") throw new Error(ENGINE);
      return quiet(method);
    });
    await draw({ engine: engineOf(request as WindowEngine["request"]), preparationError: "has not completed startup inspection and preparation" });
    await settle();
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry");
    expect(retry).toBeTruthy();
    await act(async () => retry!.click());
    await settle();
    const alert = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toBe(`Couldn't retry. ${REACH}`);
    expect(alert).not.toMatch(RAW);
  });

  it("marks a failed resume toast as bad and uses a plain sentence", async () => {
    const onToast = vi.fn();
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.fork") throw new Error(ENGINE);
      return quiet(method);
    });
    await draw({
      engine: engineOf(request as WindowEngine["request"]),
      history: [{ kind: "user", key: "u1", text: "Go on", meta: { entryId: "e1" } }],
      recoveryFailure: RESTART,
      onToast,
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid='restart-stopped'] button")!.click());
    await settle();
    expect(onToast).toHaveBeenCalledWith(REACH, { tone: "bad" });
    expect(String(onToast.mock.calls.at(-1)?.[0] ?? "")).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await draw({ earlierError: ENGINE });
    expect(host.querySelector(".stamp[role='status']")?.textContent).toBe(`Couldn't load earlier pages: ${ENGINE}`);
    const step: Block = { kind: "step", key: "s1", tool: "read", title: "Read a file", detail: "ENOENT: no such file or directory, open '/home/alex/notes/plan.md'", status: "failed" };
    await draw({ earlierPages: [{ sessionId: "old", blocks: [step] }] });
    expect(host.querySelector(".segment-line")?.textContent).toContain("ENOENT");
  });
});
