// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadContext, type ThreadContextValue } from "./context";
import { TeamProposalBlock, type TeamBlock } from "./TeamProposalBlock";
import { stateAfter, type TeamToolResult } from "./team-proposal";

const result: TeamToolResult = {
  proposal: {
    teamId: "2d60428e",
    goal: "Ship it",
    hash: "h1",
    roomId: "team-2d60428e",
    members: [
      {
        name: "Builder Researcher",
        role: "Researcher",
        job: "Find topics.",
        machine: "this",
        model: "anthropic/claude-sonnet",
      },
    ],
  },
  choices: { models: ["anthropic/claude-sonnet", "openai/gpt"], machines: ["this", "node-a"] },
};
const block: TeamBlock = { kind: "team", key: "k", result };
const roles = [{ name: "Researcher", job: "Find topics.", machine: "this", model: "anthropic/claude-sonnet" }];

type Listener = (event: { event: string; payload: unknown }) => void;
type Handler = (params: unknown) => unknown;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

/** A fake engine: the approval opens as record "appr-1", and resolving it answers with applied. */
function fakeEngine(overrides: Record<string, Handler> = {}) {
  const handlers: Record<string, Handler> = {
    "trunks.team.open": () => ({ status: "pending", approvalId: "appr-1" }),
    "approval.resolve": () => ({ applied: true }),
    ...overrides,
  };
  const listeners = new Set<Listener>();
  return {
    request: vi.fn(async (method: string, params?: unknown) => handlers[method]!(params)),
    onEvent: vi.fn((listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    /** Pushes a trunks.team.changed event to every subscriber, as the gateway does. */
    emitChange(payload: Record<string, unknown>) {
      for (const listener of listeners) listener({ event: "trunks.team.changed", payload });
    },
  };
}

type FakeEngine = ReturnType<typeof fakeEngine>;

function render(engine: FakeEngine) {
  host = document.createElement("div");
  document.body.append(host);
  const value = { name: "Ada", toast: vi.fn(), running: false, engine } as unknown as ThreadContextValue;
  root = createRoot(host);
  act(() =>
    root!.render(
      <ThreadContext.Provider value={value}>
        <TeamProposalBlock block={block} />
      </ThreadContext.Provider>,
    ),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const flush = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const stateOf = (el: HTMLElement) =>
  el.querySelector('[data-testid="team-approval-card"]')?.getAttribute("data-state");
const resolveCalls = (engine: FakeEngine) =>
  engine.request.mock.calls.filter(([method]) => method === "approval.resolve");
const openCalls = (engine: FakeEngine) =>
  engine.request.mock.calls.filter(([method]) => method === "trunks.team.open");

describe("TeamProposalBlock: opening the approval", () => {
  it("opens the team's approval once, as the record the Inbox shows", async () => {
    const engine = fakeEngine();
    const el = render(engine);
    await flush();

    expect(openCalls(engine)).toHaveLength(1);
    expect(engine.request).toHaveBeenCalledWith("trunks.team.open", {
      goal: "Ship it",
      roles,
      proposalHash: "h1",
    });
    expect(stateOf(el)).toBe("asking");
  });

  it("never reopens a declined team", async () => {
    const engine = fakeEngine({ "trunks.team.open": () => ({ status: "declined" }) });
    const el = render(engine);
    await flush();

    expect(stateOf(el)).toBe("declined");
    expect(button(el, "Approve team")).toBeUndefined();
    expect(button(el, "Not now")).toBeUndefined();
  });

  it("does not offer an approval when the engine refuses to open one", async () => {
    const el = render(fakeEngine({ "trunks.team.open": () => ({ status: "unavailable" }) }));
    await flush();

    expect(stateOf(el)).toBe("unavailable");
    expect(button(el, "Approve team")).toBeUndefined();
  });

  it("shows the persisted outcome of a team that was already created", async () => {
    const el = render(
      fakeEngine({ "trunks.team.open": () => ({ status: "applied", created: ["Builder Researcher"] }) }),
    );
    await flush();

    expect(stateOf(el)).toBe("applied");
    expect(el.textContent).toContain("Builder Researcher");
  });

  it("shows a failed create with Retry, and the engine's reason", async () => {
    const el = render(
      fakeEngine({ "trunks.team.open": () => ({ status: "failed", message: "Disk full" }) }),
    );
    await flush();

    expect(stateOf(el)).toBe("failed");
    expect(el.textContent).toContain("Disk full");
    expect(el.querySelector('[data-testid="team-retry"]')).not.toBeNull();
  });
});

describe("TeamProposalBlock: one tap", () => {
  it("makes Approve a single resolution of the record, as Allow", async () => {
    const engine = fakeEngine();
    const el = render(engine);
    await flush();

    act(() => button(el, "Approve team")!.click());
    await flush();

    expect(resolveCalls(engine)).toEqual([
      ["approval.resolve", { id: "appr-1", kind: "system-agent", decision: "allow-once" }],
    ]);
    expect(engine.request.mock.calls.some(([method]) => method === "trunks.team.approve")).toBe(false);
    expect(stateOf(el)).toBe("applying");
  });

  it("answers Not now as a denial of the same record", async () => {
    const engine = fakeEngine();
    const el = render(engine);
    await flush();

    act(() => button(el, "Not now")!.click());
    await flush();

    expect(engine.request).toHaveBeenLastCalledWith("approval.resolve", {
      id: "appr-1",
      kind: "system-agent",
      decision: "deny",
    });
    expect(stateOf(el)).toBe("declined");
  });

  it("shows Lockdown's refusal of the tap, and leaves the team unapproved", async () => {
    const engine = fakeEngine({
      "approval.resolve": () => {
        throw new Error("Lockdown is on: Trunks cannot run or send anything.");
      },
    });
    const el = render(engine);
    await flush();

    act(() => button(el, "Approve team")!.click());
    await flush();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Lockdown is on");
    expect(stateOf(el)).toBe("asking");
  });

  it("re-checks an edited team, denies the old record and opens the new one", async () => {
    const edited = { ...result, proposal: { ...result.proposal, hash: "h2" } };
    const engine = fakeEngine({
      "trunks.team.propose": () => edited,
      "trunks.team.open": (params) => ({
        status: "pending",
        approvalId: (params as { proposalHash: string }).proposalHash === "h2" ? "appr-2" : "appr-1",
      }),
    });
    const el = render(engine);
    await flush();

    act(() => button(el, "Edit")!.click());
    const job = el.querySelector<HTMLInputElement>("input[value='Find topics.']")!;
    act(() => setInput(job, "Find three topics."));
    act(() => button(el, "Save team")!.click());
    await flush();

    expect(engine.request).toHaveBeenCalledWith("approval.resolve", {
      id: "appr-1",
      kind: "system-agent",
      decision: "deny",
    });
    expect(engine.request).toHaveBeenCalledWith("trunks.team.open", expect.objectContaining({ proposalHash: "h2" }));
    act(() => button(el, "Approve team")!.click());
    await flush();
    expect(resolveCalls(engine).at(-1)).toEqual([
      "approval.resolve",
      { id: "appr-2", kind: "system-agent", decision: "allow-once" },
    ]);
  });
});

describe("TeamProposalBlock: the engine's state", () => {
  it("follows trunks.team.changed for its own proposal only", async () => {
    const engine = fakeEngine();
    const el = render(engine);
    await flush();
    act(() => button(el, "Approve team")!.click());
    await flush();

    act(() => engine.emitChange({ hash: "other", state: "applied", created: ["Stranger"] }));
    expect(stateOf(el)).toBe("applying");

    act(() => engine.emitChange({ hash: "h1", state: "applied", created: ["Builder Researcher"] }));
    expect(stateOf(el)).toBe("applied");
    expect(el.textContent).toContain("Builder Researcher");
  });

  it("shows a failed create with Retry, and Retry re-runs the same proposal", async () => {
    const engine = fakeEngine({
      "trunks.team.retry": () => ({ status: "applied", created: ["Builder Researcher"] }),
    });
    const el = render(engine);
    await flush();
    act(() => button(el, "Approve team")!.click());
    await flush();

    act(() => engine.emitChange({ hash: "h1", state: "failed", message: "Machine offline" }));
    expect(stateOf(el)).toBe("failed");
    expect(el.textContent).toContain("Machine offline");

    act(() => el.querySelector<HTMLButtonElement>('[data-testid="team-retry"]')!.click());
    await flush();

    expect(engine.request).toHaveBeenLastCalledWith("trunks.team.retry", {
      goal: "Ship it",
      roles,
      proposalHash: "h1",
    });
    expect(stateOf(el)).toBe("applied");
  });

  it("shows a declined answer for its proposal without reopening it", async () => {
    const engine = fakeEngine();
    const el = render(engine);
    await flush();

    act(() => engine.emitChange({ hash: "h1", state: "declined" }));

    expect(stateOf(el)).toBe("declined");
    expect(openCalls(engine)).toHaveLength(1);
  });
});

describe("stateAfter", () => {
  it("shows an allow as being created, and never as created", () => {
    expect(stateAfter("allow-once")).toBe("applying");
    expect(stateAfter("deny")).toBe("declined");
  });
});
