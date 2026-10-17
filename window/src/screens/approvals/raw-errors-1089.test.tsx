// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): the Asks history, an untaken ask, the Lockdown line, the Details and Helpers
// panels and Settings search's Make default put the engine's raw error on screen. They now read plain at Regular;
// Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationList } from "../../connect/conversations";
import type { WindowEngine } from "../../connect/engine";
import type { SaplingSession } from "../../connect/session";
import { CapabilityProvider } from "../../connect/capabilities";
import { R1DetailsPanel } from "../details/R1DetailsPanel";
import { useSettingsSearch } from "../frame/settings-search";
import { R1HelpersPanel } from "../helpers/R1HelpersPanel";
import { LockNotice } from "./ApprovalsLayer";
import { AskCard, AskHistory, useAsks } from "./index";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|EACCES|\/home\/|\/opt\/|TypeError|:\d+:\d+|INVALID_REQUEST/;
const FAILURES = [
  "connect ECONNREFUSED 127.0.0.1:18789",
  "ENOENT: no such file or directory, open '/home/alex/.branch/workspace/notes.md'",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
let root: Root; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const failing = (message: string) => ({ features: { methods: ["approval.history", "exec.approval.grants.list", "exec.approval.grants.revoke"], events: [] }, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], onEvent: () => () => {}, request: vi.fn(async () => { throw new Error(message); }) }) as unknown as WindowEngine;
/** An engine that answers, except the one method that fails with the raw words. */
function engineFailing(methods: string[], method: string, message: string, answer: (m: string, p?: unknown) => unknown = () => ({})) {
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const request = vi.fn(async (m: string, p?: unknown) => { if (m === method) throw new Error(message); return answer(m, p); });
  const engine = { features: { methods, events: [] }, request, onEvent: (fn: (e: { event: string; payload?: unknown }) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  const emit = async (event: string, payload: unknown) => { await act(async () => listeners.forEach((fn) => fn({ event, payload }))); await settle(); };
  return { engine, request, emit };
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); await settle(); };

const EMAIL = { id: "p1", request: { title: "Send this email to Dana Okafor?", description: "To: Dana Okafor", agentId: "ledger", sessionKey: "agent:ledger:main", allowedDecisions: ["allow-once", "allow-always", "deny"] } };
const ASKS = ["exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "plugin.approval.resolve", "question.list", "question.resolve"];
function Thread({ engine }: { engine: WindowEngine }) {
  const { asks, answer } = useAsks(engine);
  return <>{asks.map((s) => <AskCard key={s.ask.id} state={s} name="Ledger" onAnswer={(id, r) => void answer(id, r)} scopes={engine.scopes} />)}</>;
}
async function untakenAsk(raw: string): Promise<string> {
  const { engine, emit } = engineFailing(ASKS, "plugin.approval.resolve", raw, (m) => (m.endsWith(".list") ? [] : {}));
  await act(async () => root.render(<CapabilityProvider engine={engine}><Thread engine={engine} /></CapabilityProvider>));
  await settle();
  await emit("plugin.approval.requested", EMAIL);
  await click(button("Send it"));
  return host.querySelector("[role=alert]")?.textContent ?? "";
}
async function lockLine(raw: string): Promise<string> {
  const { engine } = engineFailing(["config.patch"], "none", raw);
  await act(async () => root.render(<CapabilityProvider engine={engine}><LockNotice onTurnOff={() => Promise.reject(new Error(raw)) as unknown as void} /></CapabilityProvider>));
  await settle();
  await click(button("Turn it off"));
  return document.querySelector("[data-testid=r1-lock] span")?.textContent ?? "";
}
async function routinesLine(raw: string): Promise<string> {
  const { engine } = engineFailing(["cron.list", "cron.update"], "cron.list", raw);
  const session = { request: async () => ({}), onGatewayEvent: () => () => undefined } as unknown as SaplingSession;
  await act(async () => root.render(<R1DetailsPanel session={session} engine={engine} ready kind="trunk" name="Ledger" face={null} agentId="ledger" trunks={[]} gatewayUrl="" blocks={[]} running={false} onClose={() => {}} onOpenStage={() => {}} onPip={() => {}} onChooseComputer={() => {}} openConversation={() => {}} />));
  await settle();
  return host.querySelector(".r1-details-routines [role=alert]")?.textContent ?? "";
}
async function tellItToast(raw: string): Promise<string> {
  const ROOT = "agent:scout:main";
  const helper = { key: "agent:scout:subagent:h0", spawnedBy: ROOT, status: "running", label: "Reader 1" };
  const request = vi.fn(async (m: string, p: Record<string, unknown> = {}) => {
    if (m === "sessions.send") throw new Error(raw);
    if (m === "sessions.list") return { sessions: p.spawnedBy === ROOT ? [helper] : [] };
    if (m === "canopy.cards.list") return { cards: [] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: ROOT, agentId: "scout", scopes: ["operator.admin"], features: { methods: ["sessions.list", "sessions.usage", "chat.history", "sessions.abort", "sessions.send", "canopy.cards.list"], events: [] } } as unknown as WindowEngine;
  const onToast = vi.fn();
  await act(async () => root.render(<R1HelpersPanel engine={engine} name="Scout" blocks={[]} running={false} onClose={() => {}} onToast={onToast} />));
  await settle();
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Tell it…"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, "Skip the appendix"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector<HTMLFormElement>('form[aria-label="Tell a helper"]')!.requestSubmit());
  await settle();
  return String(onToast.mock.calls.at(-1)?.[0] ?? "");
}
async function makeDefaultNotice(raw: string): Promise<string> {
  const request = vi.fn(async (m: string) => {
    if (m === "config.patch") throw new Error(raw);
    if (m === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", identity: { name: "Oak" } }, { id: "birch", identity: { name: "Birch" } }] };
    if (m === "config.get") return { hash: "h1", valid: true, config: { agents: { defaultId: "oak" } } };
    return {};
  });
  const session = { request, onGatewayEvent: () => () => undefined } as unknown as SaplingSession;
  const engine = { request, features: { methods: ["agents.list", "config.get", "config.patch"], events: [] }, scopes: ["operator.admin"] } as unknown as WindowEngine;
  const onNotice = vi.fn();
  let out: ReturnType<typeof useSettingsSearch> | null = null;
  function Probe() { out = useSettingsSearch({ session, engine, ready: true, list: {} as ConversationList, open: false, navigate: () => {}, onNotice, mainKey: () => undefined }); return null; }
  await act(async () => root.render(<Probe />));
  await settle();
  out!.onTrunk!("birch", "makeDefault");
  await settle();
  return String(onNotice.mock.calls.at(-1)?.[0] ?? "");
}

describe("R1 panels never show a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("Asks history: %j", async (raw) => {
    const engine = failing(raw);
    await act(async () => root.render(<CapabilityProvider engine={engine}><AskHistory engine={engine} /></CapabilityProvider>));
    await settle();
    expect(host.textContent).not.toMatch(RAW);
  });
  it.each(FAILURES)("an untaken ask: %j", async (raw) => {
    const line = await untakenAsk(raw);
    expect(line).toContain("That didn’t go through");
    expect(line).not.toMatch(RAW);
  });
  it.each(FAILURES)("the Lockdown line: %j", async (raw) => {
    const line = await lockLine(raw);
    expect(line.startsWith("Lockdown is still on.")).toBe(true);
    expect(line).not.toMatch(RAW);
  });
  it.each(FAILURES)("Details, its routines: %j", async (raw) => {
    const line = await routinesLine(raw);
    expect(line).not.toBe("");
    expect(line).not.toMatch(RAW);
  });
  it.each(FAILURES)("Helpers, Tell it: %j", async (raw) => {
    const toast = await tellItToast(raw);
    expect(toast).not.toBe("");
    expect(toast).not.toMatch(RAW);
  });
  it.each(FAILURES)("Settings search, Make default: %j", async (raw) => {
    const notice = await makeDefaultNotice(raw);
    expect(notice.startsWith("Couldn’t make it the default")).toBe(true);
    expect(notice).not.toMatch(RAW);
  });
  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    const engine = failing(FAILURES[0]);
    await act(async () => root.render(<CapabilityProvider engine={engine}><AskHistory engine={engine} /></CapabilityProvider>));
    await settle();
    expect(host.textContent).toContain("ECONNREFUSED");
  });
  it("Advanced keeps the exact words in an untaken ask, Details and Tell it", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(await untakenAsk(FAILURES[0])).toContain("ECONNREFUSED");
    expect(await routinesLine(FAILURES[1])).toContain("ENOENT");
    expect(await tellItToast(FAILURES[0])).toContain("ECONNREFUSED");
  });
});
