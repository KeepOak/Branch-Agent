// @vitest-environment jsdom
// Claude Code reads one status everywhere it shows: Settings › Accounts, Settings › Coding, Settings › Models and the
// first-run Your models step. With Claude Code found on this computer but no Claude Code model listed for chats, all
// four say the same plain sentence; none says "Models ready", and the step doesn't show the engine's install note.
// With its models listed for chats, Accounts and Coding say "Models ready", and Models offers them.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../../connect/capabilities";
import type { WindowEngine } from "../../../connect/engine";
import { Models } from "../../onboarding/Models";
import type { Hello } from "../../onboarding/model";
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

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "models.authStatus", "models.list",
  "branch.setup.detect", "branch.setup.verify", "branch.setup.activate", "usage.status", "users.listModelAccounts", "agents.list", "gateway.identity.get", "projects.list"];
const ONE_STATUS = "Claude Code is connected on this computer, but it isn’t set up as a model for chats yet.";
const CLAUDE_CODE_MODELS = [{ id: "claude-opus-5-5", provider: "claude-cli", name: "Claude Opus 5.5", local: false, available: true, input: ["text"] }];

/** Claude Code found on this computer as the engine reports it today, no account, and models.list as given. */
function engineWith(models: unknown[]) {
  const claude = { kind: "claude-cli", modelRef: "claude-cli/claude-opus-5-5", label: "Claude Code", detail: "installed; login status unverified" };
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "branch.setup.detect") return { candidates: [claude], unavailableCandidates: [] };
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
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
async function page(engine: WindowEngine, id: "accounts" | "coding" | "models") {
  await act(async () => root.render(<SettingsFrame key={id} engine={engine} page={id} pages={R1_PAGES} onPage={vi.fn()} />));
  await settle();
  return host.textContent ?? "";
}
function Step({ engine }: { engine: WindowEngine }) {
  const [hello, setHello] = useState<Hello>(null);
  const [off, setOff] = useState<string[]>([]);
  return <Models engine={engine} off={off} onOff={setOff} hello={hello} onHello={setHello} />;
}
async function firstRun(engine: WindowEngine) {
  await act(async () => root.render(<CapabilityProvider engine={engine}><Step key="step" engine={engine} /></CapabilityProvider>));
  await settle();
  const row = [...host.querySelectorAll<HTMLElement>(".r1-ob-row")].find((r) => r.textContent?.includes("Claude Code"));
  expect(row).toBeDefined();
  return row!.textContent ?? "";
}
/** The Claude Code row of Settings › Coding (Coding apps on this computer). */
const codingRow = (): string => {
  const row = [...host.querySelectorAll<HTMLElement>("[data-row]")].find((r) => r.getAttribute("data-row") === "Claude Code");
  expect(row).toBeDefined();
  return row!.textContent ?? "";
};

describe("Claude Code reads one status in all four places", () => {
  it("says the same plain sentence in Accounts, Coding, Models and the first-run step when no model is set up for chats", async () => {
    const engine = engineWith([]);
    const accounts = await page(engine, "accounts");
    const claude = host.querySelector<HTMLElement>('[data-row="accounts.apps.claude"]')?.textContent ?? "";
    expect(claude).toContain(ONE_STATUS);
    expect(claude).not.toContain("Models ready");
    expect(accounts).not.toContain("not a model for chats");

    await page(engine, "coding");
    const coding = codingRow();
    expect(coding).toContain(ONE_STATUS);
    expect(coding).toContain("Connected");
    expect(coding).not.toContain("Models ready");
    expect(coding).not.toContain("On because Claude Code is connected");

    const models = await page(engine, "models");
    expect(models).toContain("No model set up yet.");
    expect(models).toContain(ONE_STATUS);

    const step = await firstRun(engine);
    expect(step).toContain(ONE_STATUS);
    expect(step).not.toContain("login status unverified");
  });

  it("says Models ready in Accounts and Coding, and offers the models, once Claude Code's models are listed for chats", async () => {
    const engine = engineWith(CLAUDE_CODE_MODELS);
    await page(engine, "accounts");
    expect(host.querySelector<HTMLElement>('[data-row="accounts.apps.claude"]')?.textContent).toContain("Models ready");
    await page(engine, "coding");
    expect(codingRow()).toContain("Models ready");
    const models = await page(engine, "models");
    expect(models).not.toContain("No model set up yet");
    expect(models).not.toContain(ONE_STATUS);
    const step = await firstRun(engine);
    expect(step).toContain("On because Claude Code is connected on this computer.");
    expect(step).not.toContain(ONE_STATUS);
  });
});
