// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { connectProblem } from "./connect-problems";
import { PreConnect } from "./PreConnect";
import { firstOn, freshChoices, readDetected, readTest, setupDone, setupRecord, STEPS } from "./setup-model";
import { SetupFlow } from "./SetupFlow";
import { readChatApps, recordSetup, testModel } from "./use-setup-engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  sessionStorage.clear();
});
async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}
const byText = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const tid = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

describe("setup model", () => {
  it("has the spec's 11 steps", () => {
    expect(STEPS).toHaveLength(11);
    expect(STEPS[2]).toBe("Models");
  });
  it("reads detect, tests and the record", () => {
    const d = readDetected({
      candidates: [{ kind: "codex-cli", modelRef: "openai/x", label: "ChatGPT", detail: "Plus", recommended: true, credentials: false }],
      authOptions: [{ id: "a", label: "B", featured: false }, { id: "c", label: "D", groupLabel: "G", featured: true }],
      setupComplete: false,
    });
    expect(d.candidates[0]).toMatchObject({ key: "codex-cli|openai/x", signedOut: true });
    expect(d.authOptions.map((o) => o.label)).toEqual(["G · D", "B"]);
    expect(readTest({ ok: true, modelRef: "m", latencyMs: 1234 })).toEqual({ ok: true, seconds: "1.2", modelRef: "m" });
    expect(readTest({ ok: false, status: "auth", error: "Signed out" })).toEqual({ ok: false, error: "Signed out" });
    const record = setupRecord({ ...freshChoices("system"), promise: true, where: "remote" }, "1.0", new Date("2026-10-03T00:00:00Z"));
    expect(record).toMatchObject({ "wizard.lastRunAt": "2026-10-03T00:00:00.000Z", "wizard.lastRunMode": "remote", "wizard.securityAcknowledgedAt": "2026-10-03T00:00:00.000Z" });
    expect(setupDone({ config: { wizard: { lastRunAt: "x" } } })).toBe(true);
    expect(setupDone({ config: {} })).toBe(false);
  });
  it("chooses a signed-in account before a detected local model for a fresh default", async () => {
    const detected = readDetected({ candidates: [
      { kind: "llama-cpp", modelRef: "llama-cpp/qwen", label: "Qwen", credentials: true },
      { kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol", label: "ChatGPT", credentials: true },
      { kind: "existing-model", modelRef: "llama-cpp/qwen", label: "In use", credentials: true },
    ] });
    expect(firstOn(detected, [])?.modelRef).toBe("openai/gpt-6.1-sol");
    const { engine: e, request } = engine({ "branch.setup.activate": { ok: true, modelRef: "openai/gpt-6.1-sol", latencyMs: 800 } });
    expect(await testModel(e, detected, [], "llama-cpp/qwen")).toMatchObject({ ok: true, madeDefault: true });
    expect(params(request, "branch.setup.activate")).toEqual([{ agentId: "main", kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol" }]);
  });
  it("chat apps from channels.status and connect problems in plain words", () => {
    expect(readChatApps({ channelOrder: ["telegram", "slack"], channelLabels: { telegram: "Telegram", slack: "Slack" }, channelAccounts: { telegram: [{ connected: true }] } })).toEqual([
      { id: "telegram", label: "Telegram", connected: true },
      { id: "slack", label: "Slack", connected: false },
    ]);
    expect(connectProblem("AUTH_TOKEN_MISMATCH", "pc:1").title).toBe("pc:1 refused this key");
    expect(connectProblem(undefined, "pc:1").title).toBe("pc:1 didn't answer");
  });
});
function engine(answers: Record<string, unknown>) {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  const e = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as WindowEngine;
  return { engine: e, request };
}
const params = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter((c) => c[0] === method).map((c) => c[1] as Record<string, unknown>);

describe("setup flow", () => {
  it("Models opens the shared account catalogue with one Claude choice and no setup-token menu", async () => {
    const { engine: e, request } = engine({
      "branch.setup.detect": { secretLogins: [{ id: "setup-token", brand: "anthropic", label: "Claude setup-token", hint: "Run a command" }], authOptions: [{ id: "claude-browser", label: "Claude sign-in" }], manualProviders: [{ id: "setup-token", brandId: "anthropic", label: "Claude setup-token" }] },
      "models.authStatus": { providers: [], providerCapabilities: [{ provider: "anthropic", loginOptions: [{ id: "claude-browser", kind: "oauth", groupLabel: "Claude", label: "Sign in with Claude" }] }] },
    });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={2} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => byText(host, "Add an account").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const dialog = document.querySelector('[data-testid="add-account"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll(".prov")).toHaveLength(1);
    expect(dialog?.textContent).not.toContain("Run a command");
    expect(params(request, "models.authStatus")).toEqual([{ agentId: "main" }]);
  });
  it("Welcome holds Start until the promise is ticked and has no Skip", async () => {
    const { engine: e } = engine({});
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={() => {}} onLocalModel={() => {}} />);
    expect(tid(host, "setup-next").disabled).toBe(true);
    expect(tid(host, "setup-skip")).toBeNull();
    await act(async () => tid(host, "setup-promise").click());
    expect(tid(host, "setup-next").disabled).toBe(false);
  });
  it("Skip for now writes the setup record through config.patch", async () => {
    const { engine: e, request } = engine({ "config.get": { hash: "h", config: {} }, "config.patch": { ok: true } });
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={3} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-skip").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const raw = String(params(request, "config.patch")[0]?.raw);
    expect(JSON.parse(raw).wizard.lastRunAt).toBeTruthy();
    expect(closed).toHaveBeenCalledWith(false);
  });
  it("writes the same Install updates setting as Updates & about", async () => {
    const { engine: e, request } = engine({ "config.get": { hash: "h", config: { update: { checkOnStart: false } } }, "config.patch": { ok: true } });
    await recordSetup(e, freshChoices("system"), "1.0", false);
    const raw = JSON.parse(String(params(request, "config.patch")[0]?.raw));
    expect(raw.update).toEqual({ auto: { enabled: false }, checkOnStart: null });
  });
  it("the health check shows real answers, then finishing makes the picked Trunks", async () => {
    const { engine: e, request } = engine({
      health: { ok: true, durationMs: 4 },
      "branch.setup.verify": { ok: true, modelRef: "m", latencyMs: 900 },
      "system.info": { diskAvailableBytes: 2 * 1024 ** 3 },
      "channels.status": { channelOrder: [] },
      "config.get": { hash: "h", config: {} },
      "config.patch": { ok: true },
      "agents.create": { ok: true, agentId: "x" },
      "agents.files.get": { file: { name: "SOUL.md", missing: true } },
      "agents.files.set": { ok: true },
    });
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Researcher"]} defaultAgentId="main" defaultName="Sapling" startAt={10} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.textContent).toContain("answering in 4 ms");
    expect(host.textContent).toContain("2 GB free");
    await act(async () => tid(host, "setup-finish").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    // Researcher already exists, so setup prefills it as the only pick and makes nothing twice.
    expect(params(request, "agents.create")).toEqual([]);
    expect(closed).toHaveBeenCalledWith(true);
  });
  it("replaces a local setup default with a working signed-in model before finishing", async () => {
    const { engine: e, request } = engine({
      health: { ok: true },
      "branch.setup.detect": { candidates: [
        { kind: "llama-cpp", modelRef: "llama-cpp/qwen", credentials: true },
        { kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol", credentials: true },
        { kind: "existing-model", modelRef: "llama-cpp/qwen", credentials: true },
      ] },
      "branch.setup.verify": { ok: false, error: "No API key found for provider llama-cpp" },
      "branch.setup.activate": { ok: true, modelRef: "openai/gpt-6.1-sol", latencyMs: 800 },
      "system.info": { diskAvailableBytes: 2 * 1024 ** 3 },
      "channels.status": { channelOrder: [] },
      "config.get": { hash: "h", config: { agents: { defaults: { model: { primary: "llama-cpp/qwen" } } } } },
      "config.patch": { ok: true },
    });
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={10} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => tid(host, "setup-finish").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "branch.setup.activate")).toEqual([{ agentId: "main", kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol" }]);
    expect(closed).toHaveBeenCalledWith(true);
  });
  it("an already set-up Branch opens at the first step not done, with Models marked done and its model shown", async () => {
    const { engine: e } = engine({ "config.get": { hash: "h", config: { wizard: { securityAcknowledgedAt: "x" }, agents: { defaults: { model: { primary: "openai/gpt" } } } } } });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.querySelector("h2")?.textContent).toBe("Make it yours");
    const rail = [...host.querySelectorAll(".ob-rail li")].map((li) => li.className);
    expect(rail.slice(0, 4)).toEqual(["done", "done", "done", "now"]);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[2].click());
    expect(host.querySelector('[data-testid="setup-inuse"]')?.textContent).toContain("openai/gpt");
  });
});

describe("setup's Reach step", () => {
  it("a chat app starts the engine's own channel setup, and Your phone makes a real pairing code", async () => {
    const { engine: e, request } = engine({
      "channels.status": { channelOrder: ["telegram", "slack"], channelLabels: { telegram: "Telegram", slack: "Slack" }, channelAccounts: { slack: [{ connected: true }] } },
      "wizard.start": { sessionId: "w1", done: false, step: { id: "s1", type: "text", message: "Paste the bot token" } },
      "device.pair.setupCode": { setupId: "p1", setupCode: "ABCD-2345", qrDataUrl: "" },
    });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={5} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(tid(host, "setup-app-slack").getAttribute("aria-pressed")).toBe("true");
    await act(async () => tid(host, "setup-app-telegram").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "wizard.start")).toEqual([{ flow: "channels", channel: "telegram" }]);
    expect(document.body.textContent).toContain("Connect Telegram");
    await act(async () => (document.querySelector('[data-testid="chatapps-connect"] [aria-label="Close"]') as HTMLButtonElement | null)?.click());
    await act(async () => tid(host, "setup-phone").click());
    await act(async () => byText(document.body, "Make the code").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "device.pair.setupCode")).toHaveLength(1);
    expect(document.body.textContent).toContain("ABCD-2345");
  });
});

describe("setup's Two more things", () => {
  it("brings another assistant's memory in with migrations.memory.apply and makes the first routine with cron.add", async () => {
    const { engine: e, request } = engine({
      "migrations.memory.plan": { providers: [{ providerId: "claude-code", label: "Claude Code", found: true, planFingerprint: "fp1", items: [{ id: "a", status: "planned" }, { id: "b", status: "planned" }] }, { providerId: "hermes", label: "Hermes Agent", found: false, items: [] }] },
      "migrations.memory.apply": { summary: { migrated: 2 } },
      "plugins.list": { plugins: [{ id: "codex", installed: true }] },
      "config.get": { hash: "h", config: {} },
      "cron.add": { id: "j1" },
    });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={9} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.textContent).toContain("Claude Code · 2 ready to bring in");
    expect(host.textContent).not.toContain("Hermes Agent");
    await act(async () => tid(host, "setup-bring").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "migrations.memory.apply")[0]).toMatchObject({ agentId: "main", providerId: "claude-code", planFingerprint: "fp1", itemIds: ["a", "b"] });
    expect(host.textContent).toContain("Brought in 2 from Claude Code.");
    expect(host.textContent).toContain("Sapling reads it from now on.");
    expect(host.textContent).not.toContain("Each Trunk reads it");
    expect((host.querySelector('[data-testid="setup-otherconv"]') as HTMLInputElement).checked).toBe(true);
    const box = host.querySelector('[aria-label="A boring task"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, "Sort the receipts");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => tid(host, "setup-routine").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "cron.add")[0]).toMatchObject({ name: "Sort the receipts", agentId: "main", enabled: true });
    expect(host.textContent).toContain("weekdays at 9:00 AM · Sapling");
  });
  it("the health check also shows the computer's setup steps from the same answers", async () => {
    const { readySteps } = await import("./steps-later");
    const rows = readySteps([
      { name: "The engine", state: "ok", line: "answering in 4 ms" },
      { name: "The gateway", state: "bad", line: "not answering its health check" },
      { name: "Disk", state: "checking", line: "" },
    ]);
    expect(rows.map((r) => [r.name, r.line])).toEqual([
      ["Check this computer", "checking…"],
      ["Set up the engine", "Done"],
      ["Prepare the gateway", "not answering its health check"],
      ["Start the gateway", "not answering its health check"],
    ]);
  });
});

describe("setup on an already set-up Branch", () => {
  it("tests the model in use with verify, never activate, and finishing makes no Trunks or update setting nobody picked", async () => {
    const { engine: e, request } = engine({
      "config.get": { hash: "h", config: { wizard: { securityAcknowledgedAt: "x" }, agents: { defaults: { model: "openai/gpt" } } } },
      "branch.setup.detect": { candidates: [{ kind: "codex-cli", modelRef: "openai/x", label: "ChatGPT", detail: "Plus", recommended: true }, { kind: "existing-model", modelRef: "openai/gpt", label: "In use", detail: "", recommended: false }], setupComplete: true },
      "branch.setup.verify": { ok: true, modelRef: "openai/gpt", latencyMs: 800 },
      "config.patch": { ok: true },
    });
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={2} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[2].click());
    await act(async () => tid(host, "setup-test").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "branch.setup.activate")).toEqual([]);
    expect(params(request, "branch.setup.verify").length).toBeGreaterThan(0);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[10].click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => tid(host, "setup-finish").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "agents.create")).toEqual([]);
    const raw = JSON.parse(String(params(request, "config.patch")[0]?.raw));
    expect(raw.update).toBeUndefined();
    expect(closed).toHaveBeenCalledWith(true);
  });
});

describe("pre-connect screens", () => {
  it("say what went wrong in plain words, with the raw error folded", async () => {
    sessionStorage.setItem("branch.setupPre", JSON.stringify({ promise: true, where: "this" }));
    const host = await show(<PreConnect local="ws://127.0.0.1:18789" address="ws://127.0.0.1:18789" state={{ kind: "failed", code: "AUTH_TOKEN_MISSING", message: "token missing" }} busy={false} onConnect={() => {}} onRetry={() => {}} />);
    expect(host.textContent).toContain("This computer needs its key");
    expect(host.querySelector("details")?.textContent).toContain("127.0.0.1:18789");
    expect(host.textContent).not.toContain("VITE_GATEWAY_URL");
    expect(host.querySelector("details")?.textContent).toContain("token missing");
  });
  it("Connect hands over the address and key", async () => {
    sessionStorage.setItem("branch.setupPre", JSON.stringify({ promise: true, where: "this" }));
    const connect = vi.fn();
    const host = await show(<PreConnect local="ws://127.0.0.1:18789" address={null} state={{ kind: "address" }} busy={false} onConnect={connect} onRetry={() => {}} />);
    const key = host.querySelector('[data-testid="setup-key"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(key, "secret");
      key.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => byText(host, "Connect").click());
    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:18789", "secret");
  });
});
