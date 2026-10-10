// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { ControlTower } from "./ControlTower";
import { resetWaitingNotices } from "./notify";
import { readLimits } from "./status-data";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
});
afterEach(async () => {
  resetWaitingNotices();
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const NOW = new Date(2026, 9, 8, 12, 0).getTime();

function conv(partial: Partial<Conversation> & Pick<Conversation, "key">): Conversation {
  return {
    title: partial.title ?? partial.key,
    isMain: false,
    pinned: false,
    archived: false,
    unread: false,
    snoozedUntil: null,
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    preview: "",
    working: false,
    kind: "chat",
    system: false,
    automation: false,
    totalTokens: 0,
    contextTokens: 0,
    ...partial,
  };
}

function engine(answers: Record<string, unknown>, onEvent: WindowEngine["onEvent"] = () => () => undefined): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method in answers) return answers[method];
    if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return [];
    return {};
  });
  return {
    request,
    onEvent,
    sessionKey: "agent:ada:main",
    scopes: ["operator.admin"],
  } as unknown as WindowEngine;
}

async function show(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

const usage = {
  updatedAt: NOW - 4 * 60_000,
  providers: [{
    provider: "openai-codex",
    displayName: "ChatGPT plan",
    plan: "Plus",
    accountEmail: "ada@example.test",
    windows: [
      { label: "5h", usedPercent: 23, resetAt: new Date(2026, 9, 8, 18, 0).getTime() },
      { label: "Week", usedPercent: 41 },
    ],
  }],
};

const live = {
  "usage.status": usage,
  "cron.list": {
    jobs: [{
      id: "brief",
      displayName: "Weekday brief",
      enabled: true,
      agentId: "ada",
      schedule: { kind: "cron", expr: "30 7 * * 1-5" },
      state: { nextRunAtMs: NOW + 12 * 60_000 },
    }],
  },
  "config.get": { hash: "h1", valid: true, config: { security: { lockdown: false }, tools: { agentToAgent: { enabled: true } } } },
  "agents.list": { defaultId: "ada", agents: [{ id: "ada", identity: { name: "Ada" } }, { id: "ledger", name: "Ledger" }] },
  "audit.activity.list": {
    events: [
      { kind: "agent_run", runId: "r1", sessionKey: "agent:ledger:done", agentId: "ledger", action: "agent.run.started", occurredAt: NOW - 20 * 60_000 - 130_000 },
      { kind: "agent_run", runId: "r1", sessionKey: "agent:ledger:done", agentId: "ledger", action: "agent.run.finished", occurredAt: NOW - 20 * 60_000, status: "ok" },
    ],
  },
};

describe("Right now: Needs you, Working now and health", () => {
  it("says lockdown in the health line", async () => {
    const answers = { ...live, "config.get": { hash: "h1", valid: true, config: { security: { lockdown: true } } } };
    const host = await show(<ControlTower engine={engine(answers)} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />);
    expect(host.textContent).toContain("Lockdown is on. Trunks can only read.");
    expect(host.textContent).not.toContain("Coming up");
    expect(host.textContent).not.toContain("Accounts");
  });
  it("does not say everything is running fine when usage.status has failed or not loaded yet", async () => {
    let failUsage: (error: unknown) => void = () => undefined;
    const pending = new Promise((_resolve, reject) => { failUsage = reject; });
    const request = vi.fn(async (method: string) => {
      if (method === "usage.status") return pending;
      if (method === "cron.list") return live["cron.list"];
      if (method === "config.get") return live["config.get"];
      if (method === "agents.list") return live["agents.list"];
      if (method === "audit.activity.list") return live["audit.activity.list"];
      if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return [];
      return {};
    });
    const session = { request, onEvent: () => () => undefined, sessionKey: "agent:ada:main", scopes: ["operator.admin"] } as unknown as WindowEngine;
    const props = { engine: session, rows: [], needsCount: 0, trunkName: (id?: string) => id ?? "", onOpen: () => undefined, onInbox: () => undefined, onClose: () => undefined };
    const host = await show(<ControlTower {...props} />);
    expect(host.querySelector(".v23-tower-health")?.textContent).toBe("Checking every account…");
    expect(host.textContent).not.toContain("Everything is running fine.");
    await act(async () => { failUsage(new Error("offline")); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector(".v23-tower-health")?.textContent).toBe("Couldn’t check accounts right now. Branch will try again.");
    expect(host.textContent).not.toContain("Everything is running fine.");

    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    const healthy = await show(<ControlTower engine={engine(live)} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />);
    expect(healthy.querySelector(".v23-tower-health")?.textContent).toBe("Everything is running fine.");
  });

  it("updates the health line when a later usage poll succeeds after a failed check", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "usage.status") throw new Error("offline");
      if (method === "cron.list") return live["cron.list"];
      if (method === "config.get") return live["config.get"];
      if (method === "agents.list") return live["agents.list"];
      if (method === "audit.activity.list") return live["audit.activity.list"];
      if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return [];
      return {};
    });
    const session = { request, onEvent: () => () => undefined, sessionKey: "agent:ada:main", scopes: ["operator.admin"] } as unknown as WindowEngine;
    const host = await show(<ControlTower engine={session} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />);
    expect(host.querySelector(".v23-tower-health")?.textContent).toBe("Couldn’t check accounts right now. Branch will try again.");

    const polled = readLimits(usage, NOW);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("branch:usage-checked", { detail: polled }));
    });
    expect(host.querySelector(".v23-tower-health")?.textContent).toBe("Everything is running fine.");
    expect(host.textContent).not.toContain("Couldn’t check accounts right now");
  });

  it("does not say everything is running fine when no accounts are connected", async () => {
    const answers = { ...live, "usage.status": { updatedAt: NOW, providers: [] } };
    const host = await show(<ControlTower engine={engine(answers)} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />);
    expect(host.querySelector(".v23-tower-health")?.textContent).toBe("No accounts connected yet.");
    expect(host.textContent).not.toContain("Everything is running fine.");
  });

  it("shows a waiting item that triggers the notification in Needs you without a reload, then clears both when handled", async () => {
    const closed: string[] = [];
    const opened: Array<{ title: string; body?: string; tag?: string }> = [];
    class FakeNotice {
      title: string;
      body?: string;
      tag?: string;
      constructor(title: string, opts?: NotificationOptions) {
        this.title = title;
        this.body = typeof opts?.body === "string" ? opts.body : undefined;
        this.tag = typeof opts?.tag === "string" ? opts.tag : undefined;
        opened.push({ title: this.title, body: this.body, tag: this.tag });
      }
      close() { closed.push(this.tag ?? this.title); }
      static permission: NotificationPermission = "granted";
    }
    vi.stubGlobal("Notification", FakeNotice);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    const listeners: Array<(event: { event: string; payload?: unknown }) => void> = [];
    const answers: Record<string, unknown> = {
      ...live,
      "question.list": { questions: [] },
      "question.resolve": { status: "answered" },
    };
    const session = engine(answers, (fn) => {
      listeners.push(fn);
      return () => undefined;
    });
    const props = {
      engine: session,
      rows: [conv({ key: "agent:ada:wait", title: "Tidy the Downloads folder", agentId: "ada" })],
      needsCount: 0,
      trunkName: (id?: string) => (id === "ada" ? "Ada" : id ?? ""),
      onOpen: () => undefined,
      onInbox: () => undefined,
      onClose: () => undefined,
    };
    const host = await show(<ControlTower {...props} />);
    expect(host.textContent).toContain("Nothing is waiting for you");
    expect(opened).toEqual([]);

    const ask = {
      id: "q-wait",
      status: "pending",
      agentId: "ada",
      sessionKey: "agent:ada:wait",
      questions: [{ questionId: "which", question: "Which folder first?", options: [{ label: "Downloads" }, { label: "Desktop" }] }],
    };
    await act(async () => {
      for (const fn of listeners) fn({ event: "question.requested", payload: ask });
    });
    expect(host.textContent).toContain("Which folder first?");
    expect(host.textContent).not.toContain("Nothing is waiting for you");
    expect(opened).toEqual([{ title: "Ada", body: "is waiting for you", tag: "question:q-wait" }]);

    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Allow")?.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(session.request).toHaveBeenCalledWith("question.resolve", { id: "q-wait", answers: { answers: { which: ["Desktop"] } } });
    expect(host.textContent).toContain("Nothing is waiting for you");
    expect(host.textContent).not.toContain("Which folder first?");
    expect(closed).toEqual(["question:q-wait"]);
  });

  it("shows a needsYou conversation in Needs you without a reload", async () => {
    const props = {
      engine: engine(live),
      needsCount: 0,
      trunkName: (id?: string) => (id === "ada" ? "Ada" : id ?? ""),
      onOpen: () => undefined,
      onInbox: () => undefined,
      onClose: () => undefined,
    };
    const idle = conv({ key: "agent:ada:wait", title: "Tidy the Downloads folder", agentId: "ada" });
    const host = await show(<ControlTower {...props} rows={[idle]} />);
    expect(host.textContent).toContain("Nothing is waiting for you");
    await act(async () => {
      root?.render(<ControlTower {...props} rows={[{ ...idle, needsYou: true, headline: "Which folder first?" }]} />);
    });
    expect(host.textContent).toContain("Which folder first?");
    expect(host.textContent).not.toContain("Nothing is waiting for you");
  });
});
