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

describe("Control tower live sections", () => {
  it("shows health, Coming up, Accounts, richer Just finished and team chatter", async () => {
    const rows = [
      conv({ key: "agent:ada:work", title: "Check the invoice", agentId: "ada", working: true, headline: "Reading the statement", updatedAt: NOW }),
      conv({ key: "agent:ada:job", title: "Port the tower", agentId: "ada", working: true, helper: true, headline: "Copying the code · 42%" }),
      conv({
        key: "agent:scout:room:r1",
        agentId: "scout",
        groupChat: true,
        preview: "Found the Hartwell invoice.",
        participantIds: ["scout", "ledger"],
      }),
      conv({ key: "agent:ledger:done", title: "September expense report", agentId: "ledger", done: true, updatedAt: NOW - 20 * 60_000 }),
    ];
    const onOpen = vi.fn();
    const host = await show(<ControlTower
      engine={engine(live)}
      rows={rows}
      needsCount={0}
      trunkName={(id) => id === "ada" ? "Ada" : id === "ledger" ? "Ledger" : id === "scout" ? "Scout" : id ?? ""}
      onOpen={onOpen}
      onInbox={() => undefined}
      onClose={() => undefined}
    />);
    const text = host.textContent ?? "";
    expect(text).toContain("Everything is running fine.");
    expect(text).toContain("Check the invoice");
    expect(text).toContain("Ada · 42%");
    expect(host.querySelector(".v23-tower-bar i")?.getAttribute("style")).toContain("42%");
    expect(text).not.toContain("Scout → Ledger");
    expect(text).toContain("Found the Hartwell invoice.");
    expect(text).toContain("Who it knows");
    expect(text).toContain("September expense report");
    expect(text).toContain("2m 10s");
    expect(text).toContain("All history");
    expect(text).toContain("Weekday brief");
    expect(text).toContain("Automations");
    expect(text).toContain("ada@example.test");
    expect(text).toContain("5-hour: 77% left");
    expect(text).toContain("Week: 59% left");
    expect(text).toContain("Check now");
    expect(text).toContain("Add an account");
  });

  it("says lockdown in the health line and Check now refreshes usage", async () => {
    const answers = { ...live, "config.get": { hash: "h1", valid: true, config: { security: { lockdown: true } } } };
    const session = engine(answers);
    const host = await show(<ControlTower engine={session} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />);
    expect(host.textContent).toContain("Lockdown is on. Trunks can only read.");
    const places: unknown[] = [];
    const settings: unknown[] = [];
    window.addEventListener("branch:navigate-place", (event) => places.push((event as CustomEvent).detail));
    window.addEventListener("branch:navigate-settings", (event) => settings.push((event as CustomEvent).detail));
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Check now")?.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(session.request).toHaveBeenCalledWith("usage.status", { refresh: true });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Automations")?.click(); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "All history")?.click(); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Add an account")?.click(); });
    expect(places).toEqual([{ place: "automations" }, { place: "inbox", tab: "History" }]);
    expect(settings).toEqual([{ page: "accounts" }]);
  });

  it("disables Who it knows until Trunks load and surfaces a Check now failure", async () => {
    let finishList: (value: unknown) => void = () => undefined;
    const listed = new Promise((resolve) => { finishList = resolve; });
    const request = vi.fn(async (method: string, params?: { refresh?: boolean }) => {
      if (method === "agents.list") return listed;
      if (method === "usage.status" && params?.refresh) throw new Error("offline");
      if (method === "usage.status") return usage;
      if (method === "cron.list") return live["cron.list"];
      if (method === "config.get") return live["config.get"];
      if (method === "audit.activity.list") return live["audit.activity.list"];
      if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return [];
      return {};
    });
    const session = { request, onEvent: () => () => undefined, sessionKey: "agent:ada:main", scopes: ["operator.admin"] } as unknown as WindowEngine;
    const host = await show(<ControlTower engine={session} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />);
    const who = [...host.querySelectorAll("button")].find((button) => button.textContent === "Who it knows");
    expect(who?.disabled).toBe(true);
    expect(who?.title).toBe("Still loading Trunks.");
    await act(async () => { finishList({ defaultId: "ada", agents: [{ id: "ada", identity: { name: "Ada" } }] }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Who it knows")?.disabled).toBe(false);
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Check now")?.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector(".v23-tower-health")?.textContent).toBe("Couldn’t check accounts right now. Branch will try again.");
    expect(host.querySelector(".v23-tower-health")?.textContent).not.toContain("Everything is running fine.");
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

  it("shows a finished run in Just finished without a reload", async () => {
    const listeners: Array<(event: { event: string; payload?: unknown }) => void> = [];
    const answers: Record<string, unknown> = { ...live, "audit.activity.list": { events: [] } };
    const session = engine(answers, (fn) => {
      listeners.push(fn);
      return () => undefined;
    });
    const props = {
      engine: session,
      needsCount: 0,
      trunkName: (id?: string) => (id === "ada" ? "Ada" : id ?? ""),
      onOpen: () => undefined,
      onInbox: () => undefined,
      onClose: () => undefined,
    };
    const working = conv({ key: "agent:ada:task", title: "Tidy the Downloads folder", agentId: "ada", working: true });
    const host = await show(<ControlTower {...props} rows={[working]} />);
    expect(host.textContent).toContain("Nothing finished yet");
    expect(host.textContent).toContain("Tidy the Downloads folder");

    answers["audit.activity.list"] = {
      events: [
        { kind: "agent_run", runId: "r2", sessionKey: "agent:ada:task", agentId: "ada", action: "agent.run.started", occurredAt: NOW - 32_000 },
        { kind: "agent_run", runId: "r2", sessionKey: "agent:ada:task", agentId: "ada", action: "agent.run.finished", occurredAt: NOW, status: "ok" },
      ],
    };
    const finished = conv({ key: "agent:ada:task", title: "Tidy the Downloads folder", agentId: "ada", working: false, updatedAt: NOW });
    await act(async () => {
      root?.render(<ControlTower {...props} rows={[finished]} />);
      for (const fn of listeners) fn({ event: "chat", payload: { state: "final", sessionKey: "agent:ada:task", runId: "r2" } });
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.textContent).not.toContain("Nothing finished yet");
    expect(host.textContent).toContain("Tidy the Downloads folder");
    expect(host.textContent).toContain("32s");
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
