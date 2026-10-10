// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";
import { CONNECT_LINES, readAgents } from "./agents";

const NOW = Date.now();
const LIST = {
  enabled: true,
  agents: [
    { id: "claude-code-a1b2c3", name: "Claude Code", where: "LEGION", project: "Branch-Agent", activity: "Messaging builder-oak", activityAt: NOW, lastSeenAt: NOW, online: true, revoked: false, mayDriveWindow: false },
    { id: "hermes-agent-d4e5f6", name: "Hermes Agent", where: "keepoak-vm", lastSeenAt: NOW - 3_600_000, online: false, revoked: false, mayDriveWindow: false },
  ],
};
const CONFIG = { hash: "h1", valid: true, config: { agents: { entries: { "builder-oak": { agentToAgent: { deny: ["a2a:hermes-agent-d4e5f6"] } } } } } };

function engineWith(answers: Record<string, unknown>) {
  const request = vi.fn(async (method: string, _params?: unknown) => answers[method] ?? {});
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

describe("Settings › Grafts", () => {
  it("lists each connected agent with its face, where it runs, what it does, and per-Trunk switches", async () => {
    const { engine } = engineWith({ "contacts.outside.list": LIST, "agents.list": { agents: [{ id: "builder-oak", name: "Builder Oak" }] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Grafts" level="regular" engine={engine} />));
    await flush();
    const rows = [...document.querySelectorAll('[data-testid="connected-agent"]')];
    expect(rows.map((r) => r.getAttribute("data-agent"))).toEqual(["claude-code-a1b2c3", "hermes-agent-d4e5f6"]);
    expect(rows[0]?.textContent).toContain("Claude Code · Branch-Agent");
    expect(rows[0]?.querySelector(".rm-tag")?.textContent).toBe("A2A · LEGION");
    expect(rows[0]?.querySelector(".rm-st-online")).not.toBeNull();
    expect(rows[0]?.textContent).toContain("Online now · Messaging builder-oak");
    expect(rows[1]?.querySelector(".rm-st-online")).toBeNull();
    expect(rows[0]?.textContent).toContain("All 1 Trunks");
    expect(rows[1]?.textContent).toContain("0 of 1 Trunks");
    expect(rows[1]?.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Choose…");
    expect(rows[0]?.querySelector('button[aria-pressed="true"]')?.textContent).toBe("All Trunks");
    for (const [, line] of CONNECT_LINES) expect(document.body.textContent).toContain(line.split("\n")[0]);
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "Connect")).toHaveLength(CONNECT_LINES.length);
  });

  it("the master switch goes to the engine at once; Disconnect waits five seconds and Undo cancels it", async () => {
    vi.useFakeTimers();
    const { engine, request } = engineWith({ "contacts.outside.list": LIST, "agents.list": { agents: [] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Grafts" level="regular" engine={engine} />));
    await flush();
    await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Let other agents work with Branch"]')!.click());
    await flush();
    await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Disconnect")!.click());
    await flush();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("will disconnect");
    await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Undo")!.click());
    await act(async () => { vi.advanceTimersByTime(6000); });
    await flush();
    const sets = request.mock.calls.filter(([m]) => m === "contacts.outside.set").map(([, p]) => p);
    expect(sets).toEqual([{ enabled: false }]);
    vi.useRealTimers();
  });

  it("Disconnect sends the change after the five seconds pass", async () => {
    vi.useFakeTimers();
    const { engine, request } = engineWith({ "contacts.outside.list": LIST, "agents.list": { agents: [] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Grafts" level="regular" engine={engine} />));
    await flush();
    await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Disconnect")!.click());
    await flush();
    expect(request.mock.calls.filter(([m]) => m === "contacts.outside.set")).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    expect(request.mock.calls.filter(([m]) => m === "contacts.outside.set").map(([, p]) => p)).toEqual([{ id: "claude-code-a1b2c3", revoked: true }]);
    vi.useRealTimers();
  });

  it("groups a grafted Branch with its Trunks under one row with a Branch badge, and Disconnect is on the Branch row", async () => {
    const grafted = {
      enabled: true,
      agents: [
        { id: "branch-b--scout", name: "Scout", kind: "trunk", via: "branch-b", avatar: "branch:ember", where: "Branch B", lastSeenAt: NOW, online: true, revoked: false, mayDriveWindow: false },
        { id: "branch-b", name: "Branch B", kind: "branch", where: "STUDIO", lastSeenAt: NOW, online: true, revoked: false, mayDriveWindow: false },
        { id: "branch-b--main", name: "main", kind: "trunk", via: "branch-b", where: "Branch B", lastSeenAt: NOW, online: true, revoked: false, mayDriveWindow: false },
        LIST.agents[0],
      ],
    };
    const { engine, request } = engineWith({ "contacts.outside.list": grafted, "agents.list": { agents: [] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Grafts" level="regular" engine={engine} />));
    await flush();
    const rows = [...document.querySelectorAll('[data-testid="connected-agent"]')];
    expect(rows.map((r) => r.getAttribute("data-agent"))).toEqual(["branch-b", "claude-code-a1b2c3"]);
    const branch = rows[0]!;
    expect(branch.querySelector('[data-testid="branch-badge"]')?.textContent).toBe("Branch");
    expect(rows[1]!.querySelector('[data-testid="branch-badge"]')).toBeNull();
    expect([...branch.querySelectorAll('[data-testid="grafted-trunk"]')].map((t) => t.getAttribute("data-agent"))).toEqual(["branch-b--scout", "branch-b--main"]);
    expect(branch.querySelector('[data-agent="branch-b--scout"] img')?.getAttribute("src")).toBe("/assets/agents/ember/still.webp");
    const buttons = [...branch.querySelectorAll("button")].filter((b) => b.textContent === "Disconnect");
    expect(buttons).toHaveLength(1);
    vi.useFakeTimers();
    await act(async () => buttons[0]!.click());
    await act(async () => { vi.advanceTimersByTime(5000); });
    await flush();
    vi.useRealTimers();
    expect(request.mock.calls.filter(([m]) => m === "contacts.outside.set").map(([, p]) => p)).toEqual([{ id: "branch-b", revoked: true }]);
  });

  it("a disconnected Branch says how to bring it back instead of offering Reconnect", async () => {
    const gone = { enabled: true, agents: [{ id: "branch-b", name: "Branch B", kind: "branch", lastSeenAt: NOW, online: false, revoked: true, mayDriveWindow: false }] };
    const { engine } = engineWith({ "contacts.outside.list": gone, "agents.list": { agents: [] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Grafts" level="regular" engine={engine} />));
    await flush();
    const row = document.querySelector('[data-testid="connected-agent"]')!;
    expect([...row.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Reconnect");
    expect(row.textContent).toContain("branch graft invite");
  });

  it("reads the engine's list defensively", () => {
    expect(readAgents(undefined)).toEqual({ enabled: true, agents: [] });
    expect(readAgents({ enabled: false, agents: [{ id: "x" }] })).toEqual({ enabled: false, agents: [] });
  });
});

describe("Who it knows written before per-session ids", () => {
  it("a session's switch splits a product-wide deny into the other sessions' own entries", async () => {
    const { nextDeny, legacyOutsideId } = await import("./agents");
    expect(legacyOutsideId("claude-code-a1b2c3-2")).toBe("claude-code");
    const sessions = ["claude-code-a1b2c3", "claude-code-d4e5f6", "hermes-agent-0a0b0c"];
    expect(nextDeny(["a2a:claude-code", "scout"], "claude-code-a1b2c3", true, sessions)).toEqual(["scout", "a2a:claude-code-d4e5f6"]);
    expect(nextDeny(["scout"], "claude-code-a1b2c3", false, sessions)).toEqual(["scout", "a2a:claude-code-a1b2c3"]);
    expect(nextDeny(["a2a:claude-code-a1b2c3"], "claude-code-a1b2c3", true, sessions)).toEqual([]);
  });
});

describe("Grafts row title", () => {
  it("names the product, the project and a second session in the same folder", async () => {
    const { agentTitle } = await import("./agents");
    expect(agentTitle({ id: "claude-code-5c7e96", name: "Claude Code", project: "proof" })).toBe("Claude Code · proof");
    expect(agentTitle({ id: "claude-code-5c7e96-2", name: "Claude Code", project: "proof" })).toBe("Claude Code · proof · session 2");
    expect(agentTitle({ id: "hermes", name: "Hermes Agent" })).toBe("Hermes Agent");
  });
});


describe("Graft connect lines", () => {
  it("use the branch graft command, which survives updates", () => {
    for (const [, line] of CONNECT_LINES) expect(line).toMatch(/branch graft|\[graft\]|"graft"/);
  });
});
