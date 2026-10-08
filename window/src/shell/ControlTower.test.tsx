// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { ControlTower } from "./ControlTower";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
});
afterEach(async () => {
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

function engine(answers: Record<string, unknown>): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method in answers) return answers[method];
    if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return [];
    return {};
  });
  return {
    request,
    onEvent: () => () => undefined,
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
    expect(text).toContain("Scout → Ledger");
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
});
