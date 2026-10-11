// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { connectProblem } from "./connect-problems";
import { PreConnect } from "./PreConnect";
import { doneSteps, firstOn, freshChoices, readDetected, readTest, setupDone, setupRecord, STEPS } from "./setup-model";
import { SetupFlow } from "./SetupFlow";
import { useFirstRun } from "./use-first-run";
import type { SaplingSession } from "../connect/session";
import { readChatApps, recordSetup, testModel } from "./use-setup-engine";
import { matchPlatformLabel } from "./steps-later";
import type { TalkHandle } from "./TalkSetup";
import { WindowShell } from "../shell/WindowShell";

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
    expect(STEPS.slice(4, 10)).toEqual(["Your first Trunks", "Reach it anywhere", "Tools", "Keep it running", "People", "Two more things"]);
    expect([...doneSteps({ promise: false, where: false, model: null, jobs: [], autoUpdate: null }, false)]).toEqual([]);
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
  it("chooses a signed-in account for a fresh default but keeps a selected local model", async () => {
    const detected = readDetected({ candidates: [
      { kind: "llama-cpp", modelRef: "llama-cpp/qwen", label: "Qwen", credentials: true },
      { kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol", label: "ChatGPT", credentials: true },
    ] });
    expect(firstOn(detected, [])?.modelRef).toBe("openai/gpt-6.1-sol");
    const { engine: e, request } = engine({ "branch.setup.activate": { ok: true, modelRef: "openai/gpt-6.1-sol", latencyMs: 800 } });
    expect(await testModel(e, detected, [], null)).toMatchObject({ ok: true, madeDefault: true });
    expect(params(request, "branch.setup.activate")).toEqual([{ agentId: "main", kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol" }]);
    expect(await testModel(e, detected, [], "llama-cpp/qwen")).toMatchObject({ ok: false });
    expect(params(request, "branch.setup.verify")).toEqual([{ agentId: "main" }]);
    expect(params(request, "branch.setup.activate")).toHaveLength(1);
  });
  it("chooses a local server before installed CLIs whose sign-ins are unverified", async () => {
    const detected = readDetected({ candidates: [
      { kind: "codex-cli", modelRef: "codex-cli/gpt", detail: "installed; login status unverified" },
      { kind: "claude-cli", modelRef: "claude-cli/sonnet", detail: "installed; login status unverified" },
      { kind: "llama-cpp", modelRef: "llama-cpp/qwen", credentials: true },
    ] });
    expect(firstOn(detected, [])?.modelRef).toBe("llama-cpp/qwen");
    const { engine: e, request } = engine({ "branch.setup.activate": { ok: true, modelRef: "llama-cpp/qwen", latencyMs: 800 } });
    expect(await testModel(e, detected, [], null)).toMatchObject({ ok: true, madeDefault: true });
    expect(params(request, "branch.setup.activate")).toEqual([{ agentId: "main", kind: "llama-cpp", modelRef: "llama-cpp/qwen" }]);
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
  const request = vi.fn(async (method: string, args?: unknown) => {
    const agentId = (args as { name?: string })?.name?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (method === "agents.create" && (agentId === "branch" || agentId === "crestodian")) throw new Error(`"${agentId}" is reserved`);
    return answers[method] ?? {};
  });
  const e = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as WindowEngine;
  return { engine: e, request };
}
const params = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter((c) => c[0] === method).map((c) => c[1] as Record<string, unknown>);

describe("setup flow", () => {
  it("shows the shared reserved-name wording from WindowShell New Trunk", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    const snapshot = {
      status: { phase: "connected" }, sessionKey: null, mainKey: null, name: "Branch", history: [], live: [],
      pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null, doneAt: null,
      lastActivityAt: null, error: null, steered: [],
    };
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } };
      if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", kind: "agent", name: "Oak" }] };
      if (method === "agents.create") return { ok: false, error: { message: '"branch" is reserved' } };
      if (method === "contacts.list") return { contacts: [] };
      if (method === "rooms.list") return { rooms: [] };
      if (method === "peers.list" || method === "a2a.peers.list") return { peers: [] };
      if (method === "channels.status") return { channelOrder: [] };
      return {};
    });
    const session = {
      request, engine: { request, onEvent: () => () => {}, scopes: ["operator.admin"], agentId: "oak" },
      gatewayUrl: "ws://127.0.0.1:19661", getSnapshot: () => snapshot, subscribe: () => () => {},
      onGatewayEvent: () => () => {}, open: vi.fn(async () => {}), reload: vi.fn(),
    } as unknown as SaplingSession;
    const host = await show(<WindowShell session={session} url="ws://127.0.0.1:19661" />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    await act(async () => tid(host, "new").click());
    await act(async () => tid(host, "new-trunk").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const input = document.querySelector<HTMLInputElement>('[data-testid="new-trunk-preview"] input')!;
    expect(input).toBeTruthy();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Branch"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => byText(document.body, "Create Trunk").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(request).toHaveBeenCalledWith("agents.create", expect.objectContaining({ name: "Branch" }));
    expect(document.body.textContent).toContain("That name is kept for Branch. Choose another Trunk name.");
    expect(document.body.textContent).not.toContain('"branch" is reserved');
  });
  it.each([
    { label: "reopens first-Trunk creation through WindowShell after returning from local-model Settings", hasTrunk: false },
    { label: "keeps setup closed through WindowShell when a Trunk exists on return from Settings", hasTrunk: true },
  ])("$label", async ({ hasTrunk }) => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const snapshot = {
      status: { phase: "connected" }, sessionKey: null, mainKey: null, name: "Branch", history: [], live: [],
      pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null, doneAt: null,
      lastActivityAt: null, error: null, steered: [],
    };
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { hash: "h", config: {} };
      if (method === "agents.list") return hasTrunk
        ? { defaultId: "fern", agents: [{ id: "fern", name: "Fern" }] }
        : { defaultId: "bootstrap", agents: [{ id: "bootstrap", kind: "system", name: "Branch" }] };
      if (method === "contacts.list") return { contacts: [] };
      if (method === "rooms.list") return { rooms: [] };
      if (method === "peers.list") return { peers: [] };
      if (method === "a2a.peers.list") return { peers: [] };
      if (method === "channels.status") return { channelOrder: [] };
      return {};
    });
    const session = {
      request, engine: { request, onEvent: () => () => {}, scopes: ["operator.admin"], agentId: "bootstrap" },
      gatewayUrl: "ws://127.0.0.1:19661", getSnapshot: () => snapshot, subscribe: () => () => {},
      onGatewayEvent: () => () => {}, open: vi.fn(async () => {}), reload: vi.fn(),
    } as unknown as SaplingSession;
    const host = await show(<WindowShell session={session} url="ws://127.0.0.1:19661" />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector("h2")?.textContent).toBe("Hi, I’m Branch.");
    await act(async () => tid(host, "setup-promise").click());
    await act(async () => tid(host, "setup-next").click());
    await act(async () => tid(host, "setup-next").click());
    await act(async () => byText(host, "install a model on this computer").click());
    expect(host.textContent).toContain("Models that run here, free and private.");
    expect(host.querySelector('[data-testid="setup"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".set-back")!.click());
    expect(host.querySelector("h2")?.textContent).toBe(hasTrunk ? undefined : "Create your first Trunk");
  });
  it("opens Welcome on a fresh connection even after pre-connect choices", async () => {
    sessionStorage.setItem("branch.setupPre", JSON.stringify({ promise: true, where: "this" }));
    const session = { request: vi.fn(async () => ({ config: {} })) } as unknown as SaplingSession;
    function Probe() { const first = useFirstRun(session, true, () => false); return <span data-testid="step">{first.step ?? "waiting"}</span>; }
    const host = await show(<Probe />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("0");
  });
  it("does not reopen in another browser profile after the gateway records completion", async () => {
    const session = { request: vi.fn(async () => ({ config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } })) } as unknown as SaplingSession;
    function Probe() { const first = useFirstRun(session, true, () => false); return <span data-testid="step">{first.step ?? "closed"}</span>; }
    const host = await show(<Probe />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("closed");
    expect(session.request).toHaveBeenCalledWith("config.get", {});
  });
  it("reopens first-Trunk setup for a completed setup with no usable Trunks", async () => {
    const session = { request: vi.fn(async () => ({ config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } })) } as unknown as SaplingSession;
    function Probe() { const first = useFirstRun(session, true, () => false, 0); return <span data-testid="step">{first.step ?? "closed"}</span>; }
    const host = await show(<Probe />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("4");
  });
  it("resumes first-Trunk setup in the same session after local-model Settings when no Trunk exists", async () => {
    const session = { request: vi.fn(async () => ({ config: {} })) } as unknown as SaplingSession;
    function Probe() {
      const [inSettings, setInSettings] = useState(false);
      const first = useFirstRun(session, true, () => false, 0, inSettings);
      return <><span data-testid="step">{first.step ?? "closed"}</span>
        <button onClick={() => { first.leaveForLocalModel(); setInSettings(true); }}>Set up local model</button>
        <button onClick={() => setInSettings(false)}>Back from Settings</button></>;
    }
    const host = await show(<Probe />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("0");
    await act(async () => byText(host, "Set up local model").click());
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("closed");
    await act(async () => byText(host, "Back from Settings").click());
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("4");
  });
  it("keeps a zero-Trunk reopen on first-Trunk creation after config prefill", async () => {
    const { engine: e } = engine({ "config.get": { hash: "h", config: { wizard: { lastRunAt: "x", securityAcknowledgedAt: "x", lastRunMode: "local" }, agents: { defaults: { model: "openai/gpt" } } } } });
    const host = await show(<SetupFlow engine={e} version="1" trunkNames={[]} requireContact defaultAgentId="bootstrap" defaultName="Branch" startAt={4} onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.querySelector("h2")?.textContent).toBe("Create your first Trunk");
  });
  it("keeps an explicitly requested fresh opening on Welcome", async () => {
    const { engine: e } = engine({ "config.get": { hash: "h", config: { wizard: { lastRunAt: "x", lastRunMode: "local", securityAcknowledgedAt: "x" } } } });
    const host = await show(<SetupFlow engine={e} version="1" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={0} onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.querySelector("h2")?.textContent).toBe("Hi, I’m Branch.");
  });
  it("does not reopen Welcome after a quick Skip and retries a zero-Trunk reopen after an overlay", async () => {
    const fresh = { request: vi.fn(async () => ({ config: {} })) } as unknown as SaplingSession;
    const complete = { request: vi.fn(async () => ({ config: { wizard: { lastRunAt: "x" } } })) } as unknown as SaplingSession;
    let overlay = true;
    function Probe({ session, trunks }: { session: SaplingSession; trunks: number }) {
      const first = useFirstRun(session, true, () => overlay, trunks);
      return <><span data-testid="step">{first.step ?? "closed"}</span><button onClick={first.close}>Close</button></>;
    }
    const host = await show(<Probe session={fresh} trunks={1} />);
    await act(async () => byText(host, "Close").click());
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("closed");
    await act(async () => root!.render(<Probe session={complete} trunks={0} />));
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("closed");
    overlay = false;
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("4");
  });
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
    expect(dialog?.textContent?.toLowerCase()).not.toContain("claude setup-token");
    expect(params(request, "models.authStatus")).toEqual([{ agentId: "main" }]);
  });
  it("Make it yours says Full access does not include the screen switch", async () => {
    const { engine: e } = engine({});
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={3} onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.querySelector("h2")?.textContent).toBe("Make it yours");
    expect(host.textContent).toContain("Full access");
    expect(host.textContent).toContain("Seeing the screen and using the mouse is a separate switch in Settings › Computer & browser");
  });
  it("Welcome holds Start until the promise is ticked and has no Skip", async () => {
    const { engine: e } = engine({});
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={() => {}} onLocalModel={() => {}} />);
    expect(tid(host, "setup-next").disabled).toBe(true);
    expect(tid(host, "setup-skip")).toBeNull();
    await act(async () => tid(host, "setup-promise").click());
    expect(tid(host, "setup-next").disabled).toBe(false);
    await act(async () => tid(host, "setup-next").click());
    expect(host.querySelector("h2")?.textContent).toBe("Where should Branch run?");
    await act(async () => tid(host, "setup-next").click());
    expect(host.querySelector("h2")?.textContent).toBe("Which models should answer?");
  });
  it("visits steps 2–4 before first-contact creation, then allows Back and Skip", async () => {
    const { engine: e, request } = engine({ "config.get": { hash: "h", config: {} }, "config.patch": { ok: true }, "agents.create": { ok: true, agentId: "branch-agent" }, "agents.list": { agents: [{ id: "branch-agent", name: "Branch Agent" }] } });
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={[]} defaultAgentId="bootstrap" defaultName="Branch" onClose={closed} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-promise").click());
    for (const heading of ["Where should Branch run?", "Which models should answer?", "Make it yours", "Create your first Trunk"]) {
      await act(async () => tid(host, "setup-next").click());
      expect(host.querySelector("h2")?.textContent).toBe(heading);
    }
    await act(async () => byText(host, "Back").click());
    expect(host.querySelector("h2")?.textContent).toBe("Make it yours");
    await act(async () => tid(host, "setup-next").click());
    await act(async () => tid(host, "setup-skip").click());
    expect(closed).toHaveBeenCalledWith(false);
    expect(request).toHaveBeenCalledWith("agents.create", { name: "Branch Agent" });
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h", raw: JSON.stringify({ agents: { defaultId: "branch-agent" } }) });
    expect(params(request, "config.patch").some((patch) => Boolean(JSON.parse(String(patch.raw)).wizard?.lastRunAt))).toBe(true);
  });
  it("routes an early Skip to default-Trunk creation before setup can close", async () => {
    const { engine: e, request } = engine({});
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={[]} requireContact defaultAgentId="bootstrap" defaultName="Branch" startAt={2} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-skip").click());
    expect(host.querySelector("h2")?.textContent).toBe("Create your first Trunk");
    expect(closed).not.toHaveBeenCalled();
    expect(params(request, "config.patch")).toHaveLength(0);
  });
  it("keeps setup open when Skip cannot save the default Trunk", async () => {
    const request = vi.fn(async (method: string, args?: unknown) => {
      if (method === "agents.create") {
        if ((args as { name?: string })?.name === "Branch") throw new Error('"branch" is reserved');
        return { ok: true, agentId: "branch-agent" };
      }
      if (method === "agents.list") return { agents: [{ id: "branch-agent", name: "Branch Agent" }] };
      if (method === "config.get") return { hash: "h", config: {} };
      if (method === "config.patch") return { ok: false, error: { message: "Could not save default" } };
      return {};
    });
    const e = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={[]} requireContact defaultAgentId="bootstrap" defaultName="Branch" startAt={4} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-skip").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t save your default Trunk");
    expect(closed).not.toHaveBeenCalled();
    expect(request.mock.calls.filter(([method]) => method === "config.patch")).toHaveLength(1);
  });
  it("shows an existing default Trunk without creating a duplicate", async () => {
    const { engine: e, request } = engine({});
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["C3-PO"]} defaultAgentId="c3po" defaultName="C3-PO" startAt={4} onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.querySelector("h2")?.textContent).toBe("Your first Trunks");
    expect(host.textContent).not.toContain("Create your first Trunk");
    expect(host.querySelector(".ob-default-trunk")?.textContent).toContain("C3-PO");
    await act(async () => byText(host, "Edit").click());
    const input = host.querySelector<HTMLInputElement>('.ob-default-trunk input')!;
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
    expect(input.labels?.[0]?.textContent).toContain("Name your Trunk");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Scout"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => byText(host, "Save").click());
    expect(params(request, "agents.update")).toEqual([{ agentId: "c3po", name: "Scout" }]);
    expect(host.querySelector(".ob-default-trunk")?.textContent).toContain("Scout");
    expect(params(request, "agents.create")).toHaveLength(0);
  });
  it("explains a default-Trunk rename refusal without showing an engine object", async () => {
    const { engine: e } = engine({ "agents.update": { ok: false, error: { message: "INTERNAL_FAILURE" } } });
    const host = await show(<SetupFlow engine={e} version="1" trunkNames={["C3-PO"]} defaultAgentId="c3po" defaultName="C3-PO" startAt={4} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => byText(host, "Edit").click());
    const input = host.querySelector<HTMLInputElement>('.ob-default-trunk input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Scout"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => byText(host, "Save").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t rename this Trunk. Try again.");
    expect(host.textContent).not.toContain("[object Object]");
    expect(host.textContent).not.toContain("INTERNAL_FAILURE");
  });
  it("uses this computer’s platform throughout setup", async () => {
    sessionStorage.setItem("branch.setupPre", JSON.stringify({ promise: true, where: "this" }));
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "Linux x86_64" });
    try {
      const { engine: e } = engine({});
      const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={3} onClose={() => {}} onLocalModel={() => {}} />);
      expect(host.textContent).toContain("Match this computer");
      expect(host.textContent).not.toContain("Match Windows");
      await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[7].click());
      expect(host.textContent).toContain("Start with Linux");
      expect(host.textContent).not.toContain("Start with Windows");
    } finally {
      if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
    }
  });
  it("names the system appearance choice for macOS", () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "MacIntel" });
    try { expect(matchPlatformLabel()).toBe("Match macOS"); }
    finally { if (platform) Object.defineProperty(Navigator.prototype, "platform", platform); }
  });
  it("uses plain copy for empty tools, chat apps, and access", async () => {
    sessionStorage.setItem("branch.setupPre", JSON.stringify({ promise: true, where: "this" }));
    const { engine: e } = engine({ "channels.status": { channelOrder: [] } });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={3} onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.textContent).not.toContain("as the engine ships it");
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[5].click());
    expect(host.textContent).toContain("No chat apps are available yet");
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[6].click());
    expect(host.textContent).toContain("No command-line tools found yet");
  });
  it("routes a failed model check to the shared Add account dialog", async () => {
    const { engine: e } = engine({ "branch.setup.verify": { ok: false, error: "No agent model is configured. Run 'branch onboard' first." }, health: { ok: true }, "system.info": { diskAvailableBytes: 2 * 1024 ** 3 } });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={10} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.textContent).toContain("No model connected yet");
    expect(host.textContent).toContain("Trunks can’t answer until a model is connected.");
    expect(host.textContent).not.toContain("branch onboard");
    expect(tid(host, "setup-finish").textContent).toBe("Connect a model");
    await act(async () => tid(host, "setup-finish").click());
    expect(host.querySelector("h2")?.textContent).toBe("Which models should answer?");
    expect(document.querySelector('[data-testid="add-account"]')).not.toBeNull();
  });
  it("finishes when a detected signed-in account is switched on despite a failed initial model check", async () => {
    const { engine: e, request } = engine({
      "branch.setup.detect": { candidates: [{ kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol", label: "ChatGPT", credentials: true }] },
      "branch.setup.verify": { ok: false, error: "No agent model is configured." },
      "branch.setup.activate": { ok: true, modelRef: "openai/gpt-6.1-sol", latencyMs: 800 },
      health: { ok: true },
      "config.get": { hash: "h", config: {} },
      "config.patch": { ok: true },
    });
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={10} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(tid(host, "setup-finish").textContent).toBe("Open Branch and take the walkthrough");
    await act(async () => tid(host, "setup-finish").click());
    expect(params(request, "branch.setup.activate")).toEqual([{ agentId: "main", kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol" }]);
    expect(closed).toHaveBeenCalledWith(true);
  });
  it("Fix it on a failed model check also opens Add account", async () => {
    const { engine: e } = engine({ "branch.setup.verify": { ok: false, error: "No agent model is configured." }, health: { ok: true } });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={10} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const fix = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="setup-checks"] button')].find((b) => b.textContent === "Fix it")!;
    await act(async () => fix.click());
    expect(host.querySelector("h2")?.textContent).toBe("Which models should answer?");
    expect(document.querySelector('[data-testid="add-account"]')).not.toBeNull();
  });
  it("does not put gateway diagnostics into setup's health copy", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "branch.setup.verify") return { ok: false, error: "INTERNAL_FAILURE: modelRef=openai/gpt" };
      if (method === "health") throw new Error("ECONNREFUSED 127.0.0.1");
      if (method === "system.info") throw new Error("disk probe failed");
      return {};
    });
    const e = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
    const host = await show(<SetupFlow engine={e} version="1" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={10} onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.textContent).toContain("The model didn’t answer. Try again.");
    expect(host.textContent).not.toContain("INTERNAL_FAILURE");
    expect(host.textContent).not.toContain("ECONNREFUSED");
    expect(host.textContent).not.toContain("disk probe failed");
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
  it("Finish by talking reaches the required first Trunk, then records setup", async () => {
    const { engine: e, request } = engine({ "config.get": { hash: "h", config: {} }, "config.patch": { ok: true }, "agents.create": { ok: true, agentId: "fern" }, "agents.list": { agents: [{ id: "fern", name: "Fern" }] } });
    const onTalk = vi.fn();
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1" trunkNames={[]} requireContact defaultAgentId="bootstrap" defaultName="Branch" startAt={3} onTalk={onTalk} onClose={closed} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-talk").click());
    expect(host.querySelector("h2")).toBeNull();
    const handle = onTalk.mock.calls.find(([value]) => value)?.[0] as TalkHandle;
    await act(async () => handle.finish());
    expect(host.querySelector("h2")?.textContent).toBe("Create your first Trunk");
    expect(closed).not.toHaveBeenCalled();
    const input = host.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fern"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => tid(host, "first-trunk-create").click());
    await act(async () => tid(host, "setup-talk").click());
    const resumed = onTalk.mock.calls.filter(([value]) => value).at(-1)?.[0] as TalkHandle;
    await act(async () => resumed.finish());
    expect(closed).toHaveBeenCalledWith(true);
    expect(onTalk).toHaveBeenLastCalledWith(null);
    expect(params(request, "config.patch").some((patch) => Boolean(JSON.parse(String(patch.raw)).wizard?.lastRunAt))).toBe(true);
    expect(host.querySelector("h2")).not.toBeNull();
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
  it("does not repeat a successful Say hello test for the same model at Finish", async () => {
    sessionStorage.setItem("branch.setupPre", JSON.stringify({ promise: true, where: "this" }));
    const { engine: e, request } = engine({
      "branch.setup.detect": { candidates: [{ kind: "saved-auth:openai:a", modelRef: "openai/gpt", credentials: true }] },
      "branch.setup.activate": { ok: true, modelRef: "openai/gpt", latencyMs: 800 },
      "branch.setup.verify": { ok: true, modelRef: "openai/gpt", latencyMs: 800 },
      health: { ok: true }, "system.info": { diskAvailableBytes: 2 * 1024 ** 3 },
      "channels.status": { channelOrder: [] },
      "config.get": { hash: "h", config: {} }, "config.patch": { ok: true },
    });
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" startAt={2} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-test").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "branch.setup.activate")).toHaveLength(1);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".ob-rail li button")[10].click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => tid(host, "setup-finish").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(params(request, "branch.setup.activate")).toHaveLength(1);
  });
  it("keeps a selected local setup default even when cloud activation would fail", async () => {
    const { engine: e, request } = engine({
      health: { ok: true },
      "branch.setup.detect": { candidates: [
        { kind: "llama-cpp", modelRef: "llama-cpp/qwen", credentials: true },
        { kind: "saved-auth:openai:a", modelRef: "openai/gpt-6.1-sol", credentials: true },
        { kind: "existing-model", modelRef: "llama-cpp/qwen", credentials: true },
      ] },
      "branch.setup.verify": { ok: false, error: "No API key found for provider llama-cpp" },
      "branch.setup.activate": { ok: false, error: "Offline" },
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
    expect(params(request, "branch.setup.activate")).toEqual([]);
    expect(closed).toHaveBeenCalledWith(true);
  });
  it("an already set-up Branch opens at the first step not done, with Models marked done and its model shown", async () => {
    const { engine: e } = engine({ "config.get": { hash: "h", config: { wizard: { securityAcknowledgedAt: "x", lastRunAt: "x" }, agents: { defaults: { model: { primary: "openai/gpt" } } } } } });
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
