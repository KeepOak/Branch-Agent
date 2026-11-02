// @vitest-environment jsdom
// R1 Settings › Accounts › Coding apps (Private #1089): a row that couldn't check reads one plain sentence with Check
// again, as Classic's rows do since #1850. A sign-in failure offers Sign in again for Codex (Add a ChatGPT account) and
// plain sign-in guidance for Claude Code and Gemini CLI. The exact words show at Technical only.
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
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "models.authStatus", "models.authOrderSet", "models.probe",
  "models.authLogout", "models.authLogin", "models.authSetApiKey", "models.list", "branch.setup.detect", "usage.status", "users.listModelAccounts", "users.selectModelAccount",
  "users.unlinkAuthProfile", "agents.list", "gateway.identity.get"];
const STATUS = { providers: [], providerCapabilities: [{ provider: "openai-codex", loginOptions: [{ id: "oauth", kind: "oauth" }] }] };
const ROWS = [["accounts.apps.claude", "Claude Code"], ["accounts.apps.codex", "Codex"], ["accounts.apps.gemini", "Gemini CLI"]] as const;
const NETWORK_ERROR = "connect ECONNREFUSED";
const NETWORK_REASON = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const SIGN_IN_ERROR = "token expired (401)";
const SIGN_IN_REASON = "Branch isn’t signed in for that. Sign in again, then try again.";

function engineWith(error: string) {
  let failed = true;
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "branch.setup.detect") {
      if (failed) throw new Error(error);
      return { candidates: [{ kind: "claude-cli", credentials: true }, { kind: "codex-cli", credentials: true }, { kind: "gemini-cli", credentials: true }], unavailableCandidates: [] };
    }
    if (method === "config.get") return { hash: "h1", valid: true, config: { plugins: { entries: { codex: { enabled: false } } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "models.authStatus") return STATUS;
    if (method === "models.list") return { models: [] };
    if (method === "usage.status") return { providers: [] };
    if (method === "users.listModelAccounts") return { accounts: [] };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Main" }] };
    // The ChatGPT sign-in finishes at once, and the coding apps check again after it.
    if (method === "models.authLogin") return { ok: true };
    if (method === "wizard.next") { failed = false; return { done: true, status: "done" }; }
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request, recover: () => { failed = false; } };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const row = (id: string) => { const r = host.querySelector<HTMLElement>(`[data-row="${id}"]`); expect(r, id).not.toBeNull(); return r!; };
const line = (id: string) => row(id).querySelector(".r1s-item-t small")?.textContent;
/** The row's actions, without its Use switch. */
const actions = (id: string) => [...row(id).querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.getAttribute("role") !== "switch");
const level = (name: "Regular" | "Advanced" | "Technical") => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === name));

async function mount(env: ReturnType<typeof engineWith>, at: "Regular" | "Advanced" | "Technical" = "Regular") {
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="accounts" pages={R1_PAGES} onPage={vi.fn()} />));
  await settle();
  await level(at);
  return env;
}

describe("R1 Coding apps rows that couldn't check", () => {
  it("read one plain sentence and Check again at Regular, and Check again reloads branch.setup.detect and the model list", async () => {
    const { request, recover } = await mount(engineWith(NETWORK_ERROR));
    for (const [id] of ROWS) {
      expect(row(id).textContent).toContain("Couldn’t check");
      expect(line(id)).toBe(NETWORK_REASON);
      expect(row(id).textContent).not.toContain(NETWORK_ERROR);
      expect(actions(id).map((b) => b.textContent)).toEqual(["Check again"]);
    }
    expect(host.textContent).not.toContain("Try again");
    request.mockClear();
    recover();
    await click(actions("accounts.apps.claude")[0]);
    expect(request.mock.calls.map(([method]) => method)).toEqual(["branch.setup.detect", "models.list"]);
    for (const [id] of ROWS) expect(row(id).textContent).not.toContain("Couldn’t check");
  });

  it("never shows the raw 401 at Regular", async () => {
    await mount(engineWith(SIGN_IN_ERROR));
    for (const [id] of ROWS) {
      expect(row(id).textContent).not.toMatch(/401|token/i);
      expect(row(id).textContent).not.toContain("Try again");
    }
  });

  it("offers Sign in again for Codex, which opens Add a ChatGPT account without starting a sign-in", async () => {
    const { request } = await mount(engineWith(SIGN_IN_ERROR));
    expect(line("accounts.apps.codex")).toBe(SIGN_IN_REASON);
    expect(actions("accounts.apps.codex").map((b) => b.textContent)).toEqual(["Sign in again"]);
    request.mockClear();
    await click(actions("accounts.apps.codex")[0]);
    const dialog = document.querySelector('[data-testid="add-account"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Add a ChatGPT account");
    expect(request.mock.calls.map(([method]) => method)).not.toContain("models.authLogin");
  });

  it("checks the Codex row again after Sign in again adds an account", async () => {
    const { request } = await mount(engineWith(SIGN_IN_ERROR));
    const codex = "accounts.apps.codex";
    expect(line(codex)).toBe(SIGN_IN_REASON);
    await click(actions(codex)[0]);
    const dialog = () => document.querySelector<HTMLElement>('[data-testid="add-account"]');
    await click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Open the sign-in page"));
    request.mockClear();
    await click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Done"));
    expect(dialog()).toBeNull();
    expect(request.mock.calls.map(([method]) => method)).toContain("branch.setup.detect");
    expect(row(codex).querySelector(".r1s-item-t b")?.textContent).toBe("Models ready");
    expect(line(codex)).toBe("Codex is connected on this computer. Turn it on to use its models.");
    expect(row(codex).textContent).not.toContain(SIGN_IN_REASON);
    expect(actions(codex).map((b) => b.textContent)).toEqual([]);
  });

  it("does not check again when the Add a ChatGPT account dialog closes without an account", async () => {
    const { request } = await mount(engineWith(SIGN_IN_ERROR));
    await click(actions("accounts.apps.codex")[0]);
    request.mockClear();
    await click(document.querySelector('[data-testid="add-account"] button[aria-label="Close"]'));
    expect(document.querySelector('[data-testid="add-account"]')).toBeNull();
    expect(request.mock.calls.map(([method]) => method)).not.toContain("branch.setup.detect");
    expect(line("accounts.apps.codex")).toBe(SIGN_IN_REASON);
  });

  it("gives Claude Code and Gemini CLI plain sign-in guidance and no Sign in again", async () => {
    const { request, recover } = await mount(engineWith(SIGN_IN_ERROR));
    for (const [id, name] of ROWS.filter(([id]) => id !== "accounts.apps.codex")) {
      expect(line(id)).toBe(`Open ${name} on this computer and sign in there, then choose Check again.`);
      expect(actions(id).map((b) => b.textContent)).toEqual(["Check again"]);
      expect(row(id).textContent).not.toContain("Sign in again");
    }
    request.mockClear();
    recover();
    await click(actions("accounts.apps.gemini")[0]);
    expect(request.mock.calls.map(([method]) => method)).toEqual(["branch.setup.detect", "models.list"]);
    expect(document.querySelector('[data-testid="add-account"]')).toBeNull();
  });

  it("shows the raw reason at Technical only; Advanced keeps the plain sentence", async () => {
    await mount(engineWith(SIGN_IN_ERROR), "Advanced");
    expect(line("accounts.apps.codex")).toBe(SIGN_IN_REASON);
    expect(line("accounts.apps.claude")).toBe("Open Claude Code on this computer and sign in there, then choose Check again.");
    await level("Technical");
    for (const [id] of ROWS) expect(line(id)).toBe(SIGN_IN_ERROR);
    await level("Regular");
    expect(line("accounts.apps.codex")).toBe(SIGN_IN_REASON);
    expect(line("accounts.apps.gemini")).toBe("Open Gemini CLI on this computer and sign in there, then choose Check again.");
  });
});
