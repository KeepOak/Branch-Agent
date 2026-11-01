// @vitest-environment jsdom
// Settings › Accounts reads the model list the way Settings › Models does: for the default Trunk (with several Trunks
// the engine refuses a models.list that names none), again on Check again, and with the one shared rule for which
// listed models are ready for chats.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { appChatModels, modelsOf, readyForChats } from "../../../places/settings/set1/models-data";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "models.authStatus", "models.authOrderSet", "models.probe",
  "models.authLogout", "models.authLogin", "models.authSetApiKey", "models.list", "branch.setup.detect", "usage.status", "users.listModelAccounts", "users.selectModelAccount",
  "users.unlinkAuthProfile", "agents.list", "gateway.identity.get"];
const OPUS = { id: "claude-opus-5-5", provider: "claude-cli", name: "Claude Opus 5.5", local: false, input: ["text"] };
const CODING_APP = "Claude Code is a coding app on this computer, not a model for chats.";

/** Two Trunks, Claude Code signed in on this computer, no account in models.authStatus. models.list answers only when
 *  it names a Trunk, as the engine does with several Trunks. */
function engineWith(models: () => unknown[]) {
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "branch.setup.detect") return { candidates: [{ kind: "claude-cli", credentials: true }], unavailableCandidates: [] };
    if (method === "models.list") {
      if (!params?.agentId) throw new Error("Multiple agents are configured; pass agentId.");
      return { models: models() };
    }
    if (method === "models.authStatus") return { providers: [] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "usage.status") return { providers: [] };
    if (method === "users.listModelAccounts") return { accounts: [] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Main" }, { id: "scout", name: "Scout" }] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function show(engine: WindowEngine, page: "accounts" | "models") {
  await act(async () => root.render(<SettingsFrame key={page} engine={engine} page={page} pages={R1_PAGES} onPage={vi.fn()} />));
  await settle();
}
const claudeRow = () => { const r = host.querySelector<HTMLElement>('[data-row="accounts.apps.claude"]'); expect(r).not.toBeNull(); return r!; };
const listCalls = (request: ReturnType<typeof engineWith>["request"]) => request.mock.calls.filter(([m]) => m === "models.list");

describe("Accounts reads the model list as Models does", () => {
  it("names the default Trunk in models.list, so with several Trunks Accounts doesn't fall back to Models ready", async () => {
    const { engine, request } = engineWith(() => []);
    await show(engine, "accounts");
    expect(listCalls(request).some(([, params]) => (params as { agentId?: string } | undefined)?.agentId === "main")).toBe(true);
    const row = claudeRow();
    expect(row.textContent).not.toContain("Models ready");
    expect(row.textContent).toContain(CODING_APP);
  });

  it("Check again reads the model list again with the coding apps", async () => {
    let models: unknown[] = [];
    const { engine, request } = engineWith(() => models);
    await show(engine, "accounts");
    expect(claudeRow().textContent).toContain(CODING_APP);
    const before = listCalls(request).length;
    models = [{ ...OPUS, available: true }];
    const again = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Check again");
    expect(again).toBeDefined();
    await act(async () => again!.click());
    await settle();
    expect(listCalls(request).length).toBeGreaterThan(before);
    expect(claudeRow().textContent).toContain("Models ready");
    expect(claudeRow().textContent).not.toContain(CODING_APP);
  });

  it("uses one rule on both screens: a model with no available field is ready for chats, available: false is not", async () => {
    expect(readyForChats({})).toBe(true);
    expect(readyForChats({ available: true })).toBe(true);
    expect(readyForChats({ available: false })).toBe(false);
    const parsed = modelsOf({ models: [OPUS, { ...OPUS, id: "claude-haiku", available: false }] });
    expect(appChatModels(parsed, "claude-cli").map((m) => m.id)).toEqual(["claude-opus-5-5"]);

    const { engine } = engineWith(() => [OPUS]);
    await show(engine, "accounts");
    expect(claudeRow().textContent).toContain("Models ready");
    await show(engine, "models");
    expect(host.textContent).not.toContain("No model set up yet");
    expect(host.querySelector('[data-row="Claude Code"]')).not.toBeNull();
  });
});
