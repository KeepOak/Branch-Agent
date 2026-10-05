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

describe("Settings › Connected agents", () => {
  it("lists each connected agent with its face, where it runs, what it does, and per-Trunk switches", async () => {
    const { engine } = engineWith({ "contacts.outside.list": LIST, "agents.list": { agents: [{ id: "builder-oak", name: "Builder Oak" }] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Connected agents" level="regular" engine={engine} />));
    await flush();
    const rows = [...document.querySelectorAll('[data-testid="connected-agent"]')];
    expect(rows.map((r) => r.getAttribute("data-agent"))).toEqual(["claude-code-a1b2c3", "hermes-agent-d4e5f6"]);
    expect(rows[0]?.textContent).toContain("Claude Code · Branch-Agent");
    expect(rows[0]?.querySelector(".rm-tag")?.textContent).toBe("A2A · LEGION");
    expect(rows[0]?.querySelector(".rm-st-online")).not.toBeNull();
    expect(rows[0]?.textContent).toContain("Online now · Messaging builder-oak");
    expect(rows[1]?.querySelector(".rm-st-online")).toBeNull();
    const may = (row: Element) => row.querySelector<HTMLInputElement>('input[aria-label$="may message Builder Oak"]')?.checked;
    expect(may(rows[0]!)).toBe(true);
    expect(may(rows[1]!)).toBe(false);
    for (const [, line] of CONNECT_LINES) expect(document.body.textContent).toContain(line.split("\n")[0]);
  });

  it("the master switch and Disconnect go to the engine", async () => {
    const { engine, request } = engineWith({ "contacts.outside.list": LIST, "agents.list": { agents: [] }, "config.get": CONFIG });
    await act(async () => root.render(<SettingsPage page="agents" title="Connected agents" level="regular" engine={engine} />));
    await flush();
    await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Let other agents work with Branch"]')!.click());
    await flush();
    await act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Disconnect")!.click());
    await flush();
    const sets = request.mock.calls.filter(([m]) => m === "contacts.outside.set").map(([, p]) => p);
    expect(sets).toEqual([{ enabled: false }, { id: "claude-code-a1b2c3", revoked: true }]);
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

describe("Connected agents row title", () => {
  it("names the product, the project and a second session in the same folder", async () => {
    const { agentTitle } = await import("./agents");
    expect(agentTitle({ id: "claude-code-5c7e96", name: "Claude Code", project: "proof" })).toBe("Claude Code · proof");
    expect(agentTitle({ id: "claude-code-5c7e96-2", name: "Claude Code", project: "proof" })).toBe("Claude Code · proof · session 2");
    expect(agentTitle({ id: "hermes", name: "Hermes Agent" })).toBe("Hermes Agent");
  });
});

