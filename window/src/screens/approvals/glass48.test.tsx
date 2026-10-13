// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Frame } from "../frame/Frame";
import { ApprovalsLayer, AskCard, AskHistory, useAsks } from "./index";

/* README item 48 (owner, final): only the window's left sidebar is frosted. The approval card, the Live-Activity drop, the
   banners, the Lockdown line, the answered list and the window's notice line are clear glass, and every piece of text and
   every control on them sits on a small frosted pill with a 1px outline. The pills use the one shared pill token set (--gp-* in
   theme/tokens.css), so they follow High contrast and Reduce transparency (the app setting and the system one) like every
   other screen. The pill is approvals.css's own frosted-pill rule, the shared .g-label / .g-frost, or a solid primary button. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const css = readFileSync("src/screens/approvals/approvals.css", "utf8");
const FROST = css.match(/\/\* The frost[^*]*\*\/\s*([^{]+)\{([^}]*)\}/)!;
const PILL = [".g-label", ".g-frost", "[data-solid]", ".g-clear button", ".g-clear input", ...FROST[1].replace(/\s+/g, " ").trim().replace(/^:is\(/, "").replace(/\)\s*$/, "").split(/,(?![^(]*\))/).map((s) => s.trim())].join(", ");
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
type Handler = (method: string, params: unknown) => unknown;
function engineOf(methods: string[], handler: Handler = () => ({})) {
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const request = vi.fn(async (method: string, params?: unknown) => { const v = handler(method, params); if (v instanceof Error) throw v; return v; });
  const engine = { features: { methods, events: [] }, request, onEvent: (fn: (e: { event: string; payload?: unknown }) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  const emit = async (event: string, payload: unknown) => { await act(async () => listeners.forEach((fn) => fn({ event, payload }))); await settle(); };
  return { engine, emit };
}
async function render(engine: WindowEngine, node: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}>{node}</CapabilityProvider>));
  await settle();
  return host;
}
/** Text that sits straight on a clear surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of [scope, ...scope.querySelectorAll("*")]) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    if (!el.closest(PILL)) bare.push("<" + el.tagName.toLowerCase() + " class=\"" + el.className + "\"> " + el.textContent!.trim().slice(0, 48));
  }
  return bare;
}
const EMAIL = { id: "p1", request: { title: "Send this email to Dana Okafor?", description: "To: Dana Okafor\nSubject: Thursday", agentId: "ledger", sessionKey: "agent:ledger:main", allowedDecisions: ["allow-once", "allow-always", "deny"] } };
const ALL = ["exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "plugin.approval.resolve", "question.list", "question.resolve", "agents.list", "config.get", "config.patch"];
const lists: Handler = (m) => (m === "agents.list" ? { agents: [{ id: "ledger", identity: { name: "Ledger" } }] } : m === "config.get" ? { hash: "h", valid: true, config: { security: { lockdown: true } } } : m.endsWith(".list") ? [] : {});

function Thread({ engine }: { engine: WindowEngine }) {
  const { asks, answer } = useAsks(engine);
  return <>{asks.map((s) => <AskCard key={s.ask.id} state={s} name="Ledger" onAnswer={(id, r) => void answer(id, r)} scopes={engine.scopes} />)}</>;
}

describe("approvals and banners follow the item 48 glass model", () => {
  it("draws the approval card and a question clear, with every line and answer on a pill and the primary answer solid", async () => {
    const { engine, emit } = engineOf(ALL, lists);
    const host = await render(engine, <Thread engine={engine} />);
    await emit("plugin.approval.requested", EMAIL);
    await emit("question.requested", { id: "q1", status: "pending", createdAtMs: 1, expiresAtMs: Date.now() + 60_000, questions: [
      { questionId: "when", header: "Flight", question: "Which flight?", options: [{ label: "Morning" }, { label: "Evening" }], multiSelect: true },
      { questionId: "note", question: "Anything else?", options: [], isOther: true },
    ] });
    const cards = [...host.querySelectorAll(".r1-ask")];
    expect(cards).toHaveLength(2);
    for (const card of cards) { expect(card.classList).toContain("g-clear"); expect(bareText(card)).toEqual([]); }
    const primaries = [...host.querySelectorAll(".r1-ask-btn[data-kind=primary]")];
    expect(primaries.length).toBeGreaterThan(0);
    for (const primary of primaries) expect(primary.hasAttribute("data-solid")).toBe(true);
  });

  it("keeps the drop, the Lockdown line and a decided card clear with their words on pills", async () => {
    const { engine, emit } = engineOf(ALL, lists);
    await render(engine, <><ApprovalsLayer engine={engine} sessionKey="agent:main:main" view="chat" onOpen={() => undefined} /><Thread engine={engine} /></>);
    await emit("plugin.approval.requested", EMAIL);
    await emit("exec.approval.requested", { id: "e1", request: { command: "ls", sessionKey: "agent:scout:main", agentId: "ledger" } });
    const drop = document.querySelector(".r1-drop")!;
    expect(drop.classList).toContain("g-clear");
    expect(bareText(drop)).toEqual([]);
    for (const primary of drop.querySelectorAll(".r1-ask-btn[data-kind=primary]")) expect(primary.hasAttribute("data-solid")).toBe(true);
    expect(bareText(document.querySelector(".r1-lock")!)).toEqual([]);
    await emit("plugin.approval.resolved", { id: "p1", decision: "allow-once" });
    const decided = document.querySelector(".r1-ask-decided")!;
    expect(decided.classList).toContain("g-clear");
    expect(bareText(decided)).toEqual([]);
  });

  it("raises banners as clear rows of pills", async () => {
    const { engine, emit } = engineOf(ALL, lists);
    await render(engine, <ApprovalsLayer engine={engine} sessionKey={null} view="other" onOpen={() => undefined} />);
    await emit("plugin.approval.requested", EMAIL);
    const banner = document.querySelector(".r1-banner")!;
    expect(banner.classList).toContain("g-clear");
    expect(bareText(banner)).toEqual([]);
    for (const primary of banner.querySelectorAll(".r1-ask-btn[data-kind=primary]")) expect(primary.hasAttribute("data-solid")).toBe(true);
  });

  it("puts the answered list and the standing grants on pills", async () => {
    const { engine } = engineOf(["approval.history", "exec.approval.grants.list", "exec.approval.grants.revoke"], (m) => (
      m === "approval.history" ? { items: [{ id: "a1", status: "allowed", decision: "allow-once", resolvedAtMs: 5, presentation: { title: "Send this email?" } }], nextCursor: "c2" }
        : m === "exec.approval.grants.list" ? { grants: [{ grantId: "g1", command: "backup.sh", cronJobName: "Nightly backup", useCount: 3 }] } : {}));
    const host = await render(engine, <AskHistory engine={engine} />);
    const list = host.querySelector(".r1-ask-history")!;
    expect(list.textContent).toContain("Nightly backup");
    expect(list.classList).toContain("g-clear");
    expect(bareText(list)).toEqual([]);
  });

  it("puts the window's notice line, and a part that didn't load, on a pill", async () => {
    const Broken = () => { throw new Error("boom"); };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const host = await render(engineOf([]).engine, <Frame sidebar={<span />} main={<p>Chat</p>} notice="Reconnecting…" header={{ title: "Chat" }} />);
    const notice = host.querySelector(".r1-notice")!;
    expect(notice.textContent).toBe("Reconnecting…");
    expect(notice.classList).toContain("g-label");
    await act(async () => root!.render(<Frame sidebar={<span />} main={<Broken />} header={{ title: "Chat" }} />));
    const failed = host.querySelector(".r1-notice[role=alert]")!;
    expect(failed.textContent).toContain("This part didn’t load");
    expect(failed.classList).toContain("g-label");
    expect(bareText(failed)).toEqual([]);
  });

  it("draws every pill from the shared pill tokens, so High contrast and Reduce transparency reach it", () => {
    const flat = css.replace(/\s+/g, " ");
    expect(FROST[2]).toContain("var(--gp-fill)");
    expect(FROST[2]).toContain("var(--gp-edge)");
    expect(FROST[2]).toContain("var(--gp-blur)");
    expect(flat).not.toMatch(/--r1a-(fill|edge|on|ink2|blur)/);
    expect(flat).not.toMatch(/var\(--g[cfk]-/);
  });
});
