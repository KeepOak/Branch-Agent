// @vitest-environment jsdom
// Settings › Accounts and Settings › Models tell the same story about Claude Code. With Claude Code signed in on this
// computer and no other account, the engine lists Claude Code's models (models.list) but models.authStatus has no
// account for them. Models offers those models instead of "No model set up yet". When the engine lists none for chats,
// Accounts says Claude Code is a coding app, not "Models ready".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
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
const CLAUDE_CODE_MODELS = [
  { id: "claude-opus-5-5", provider: "claude-cli", name: "Claude Opus 5.5", local: false, available: true, input: ["text", "image"] },
  { id: "claude-sonnet-5-5", provider: "claude-cli", name: "Claude Sonnet 5.5", local: false, available: true, input: ["text", "image"] },
];

/** Claude Code signed in on this computer, no account in models.authStatus, and models.list as given. */
function engineWith(models: unknown[]) {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "branch.setup.detect") return { candidates: [{ kind: "claude-cli", credentials: true }], unavailableCandidates: [] };
    if (method === "models.list") return { models };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "usage.status") return { providers: [] };
    if (method === "users.listModelAccounts") return { accounts: [] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Main" }] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function show(engine: WindowEngine, page: "accounts" | "models") {
  await act(async () => root.render(<SettingsFrame key={page} engine={engine} page={page} pages={R1_PAGES} onPage={vi.fn()} />));
  await settle();
}
const claudeRow = () => { const r = host.querySelector<HTMLElement>('[data-row="accounts.apps.claude"]'); expect(r).not.toBeNull(); return r!; };

describe("Accounts and Models agree on Claude Code", () => {
  it("offers Claude Code's models in Models when Accounts says Claude Code is ready", async () => {
    const engine = engineWith(CLAUDE_CODE_MODELS);
    await show(engine, "accounts");
    expect(claudeRow().textContent).toContain("Models ready");
    await show(engine, "models");
    expect(host.textContent).not.toContain("No model set up yet");
    const row = host.querySelector<HTMLElement>('[data-row="Claude Code"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Signed in with Claude Code on this computer");
    const pick = row!.querySelector<HTMLSelectElement>("select");
    expect([...(pick?.options ?? [])].map((o) => o.textContent)).toEqual(["Claude Opus 5.5", "Claude Sonnet 5.5"]);
  });

  it("says plainly in Accounts that Claude Code is a coding app when Models has no model for chats", async () => {
    const engine = engineWith([]);
    await show(engine, "models");
    expect(host.textContent).toContain("No model set up yet");
    await show(engine, "accounts");
    const row = claudeRow();
    expect(row.textContent).not.toContain("Models ready");
    expect(row.textContent).toContain("Connected");
    expect(row.textContent).toContain("Claude Code is a coding app on this computer, not a model for chats.");
  });

  it("does not count Claude Code's models the engine says it can't use", async () => {
    const engine = engineWith(CLAUDE_CODE_MODELS.map((m) => ({ ...m, available: false })));
    await show(engine, "models");
    expect(host.textContent).toContain("No model set up yet");
    await show(engine, "accounts");
    expect(claudeRow().textContent).not.toContain("Models ready");
  });
});
