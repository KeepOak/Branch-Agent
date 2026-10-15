// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { ApprovalsLayer, AskCard, AskHistory, Banners, useAsks } from "./index";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });

type Handler = (method: string, params: unknown) => unknown;
function engineOf(methods: string[], handler: Handler = () => ({})) {
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const request = vi.fn(async (method: string, params?: unknown) => {
    const value = handler(method, params);
    if (value instanceof Error) throw value;
    return value;
  });
  const engine = { features: { methods, events: [] }, request, onEvent: (fn: (e: { event: string; payload?: unknown }) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  const emit = async (event: string, payload: unknown) => { await act(async () => listeners.forEach((fn) => fn({ event, payload }))); await settle(); };
  return { engine, request, emit };
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function render(engine: WindowEngine, node: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}>{node}</CapabilityProvider>));
  await settle();
  return host;
}
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); await settle(); };
const EMAIL = { id: "p1", request: { title: "Send this email to Dana Okafor?", description: "To: Dana Okafor\nSubject: Thursday", agentId: "ledger", sessionKey: "agent:ledger:main", allowedDecisions: ["allow-once", "allow-always", "deny"] } };
const ALL = ["exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "plugin.approval.resolve", "question.list", "question.resolve", "agents.list", "config.get", "config.patch"];

function Thread({ engine }: { engine: WindowEngine }) {
  const { asks, answer } = useAsks(engine);
  return <>{asks.map((s) => <AskCard key={s.ask.id} state={s} name="Ledger" onAnswer={(id, r) => void answer(id, r)} scopes={engine.scopes} />)}</>;
}

describe("R1-05 approvals", () => {
  it("renders against an empty engine: no calls, every answer Coming, nothing undeclared", async () => {
    const { engine, request, emit } = engineOf([]);
    const host = await render(engine, <><Thread engine={engine} /><AskHistory engine={engine} /></>);
    expect(request).not.toHaveBeenCalled();
    await emit("plugin.approval.requested", EMAIL);
    expect(host.querySelector(".r1-ask-q")?.textContent).toBe("Send this email to Dana Okafor?");
    expect(host.querySelector(".r1-ask")?.className).toBe("r1-ask g-clear");
    expect(button(host, "Send it").getAttribute("aria-disabled")).toBe("true");
    expect(undeclaredControls(host).map((e) => e.textContent)).toEqual([]);
    expect(comingControls().some((c) => c.need.includes("plugin.approval.resolve"))).toBe(true);
    await click(button(host, "Send it"));
    expect(request).not.toHaveBeenCalled();
  });

  it("shows the card from the pending list, answers with plugin.approval.resolve and collapses to ✓ Sent", async () => {
    const { engine, request } = engineOf(ALL, (m) => (m === "plugin.approval.list" ? [EMAIL] : m.endsWith(".list") ? [] : {}));
    const host = await render(engine, <Thread engine={engine} />);
    expect([...host.querySelectorAll(".r1-ask-kv dt")].map((d) => d.textContent)).toEqual(["To", "Subject"]);
    expect([...host.querySelectorAll(".r1-ask-acts button")].map((b) => b.textContent)).toEqual(["Send it", "Always allow for Ledger", "Don’t send"]);
    await click(button(host, "Send it"));
    expect(request).toHaveBeenCalledWith("plugin.approval.resolve", { id: "p1", decision: "allow-once" });
    expect(host.querySelector("[data-testid=r1-ask]")?.getAttribute("data-state")).toBe("allow-once");
    expect(host.querySelector(".r1-ask-pill")?.textContent).toBe("✓ Sent");
  });

  it("keeps the card open with the engine's words when resolving fails, and collapses when answered elsewhere", async () => {
    let fail = true;
    const { engine, emit } = engineOf(ALL, (m) => (m === "plugin.approval.resolve" && fail ? new Error("The approval store is busy.") : m.endsWith(".list") ? [] : {}));
    const host = await render(engine, <Thread engine={engine} />);
    await emit("plugin.approval.requested", EMAIL);
    await click(button(host, "Don’t send"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("The approval store is busy.");
    expect(button(host, "Send it")).toBeTruthy();
    fail = false;
    await emit("plugin.approval.resolved", { id: "p1", decision: "allow-once" });
    expect(host.querySelector(".r1-ask-pill")?.textContent).toBe("Answered elsewhere");
  });

  it("answers a question with its option through question.resolve", async () => {
    const { engine, request, emit } = engineOf(ALL, (m) => (m.endsWith(".list") ? [] : m === "question.resolve" ? { status: "answered", answers: { answers: {} } } : {}));
    const host = await render(engine, <Thread engine={engine} />);
    await emit("question.requested", { id: "q1", status: "pending", createdAtMs: 1, expiresAtMs: Date.now() + 60_000, questions: [{ questionId: "when", header: "Flight", question: "Which flight?", options: [{ label: "Morning" }, { label: "Evening" }] }] });
    await click(button(host, "Evening"));
    expect(request).toHaveBeenCalledWith("question.resolve", { id: "q1", answers: { answers: { when: ["Evening"] } } });
    expect(host.querySelector(".r1-ask-pill")?.textContent).toBe("✓ Answered");
  });

  it("drops another conversation's approval under the header with +N, answers Yes, shows ✓ Done, then lifts away", async () => {
    const { engine, request, emit } = engineOf(ALL, (m) => (m === "agents.list" ? { agents: [{ id: "ledger", identity: { name: "Ledger" } }] } : m.endsWith(".list") ? [] : {}));
    const host = await render(engine, <ApprovalsLayer engine={engine} sessionKey="agent:main:main" view="chat" onOpen={() => undefined} />);
    await emit("plugin.approval.requested", EMAIL);
    await emit("exec.approval.requested", { id: "e1", request: { command: "ls", sessionKey: "agent:scout:main", agentId: "ledger" } });
    const drop = document.querySelector("[data-testid=r1-drop]")!;
    expect(drop.textContent).toContain("Ledger needs you");
    expect(drop.textContent).toContain("Send this email to Dana Okafor?");
    expect(drop.querySelector(".r1-drop-more")?.textContent).toBe("+1");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await click(button(drop, "Yes"));
    expect(request).toHaveBeenCalledWith("plugin.approval.resolve", { id: "p1", decision: "allow-once" });
    expect(document.querySelector(".r1-drop-done")?.textContent).toBe("✓ Done");
    await act(async () => { vi.advanceTimersByTime(1000); });
    await settle();
    expect(document.querySelector("[data-testid=r1-drop]")?.textContent).toContain("Run this command?");
    expect(host).toBeTruthy();
  });

  it("raises a banner with Yes / No / Open elsewhere in the app, and the Lockdown notice holds Yes back", async () => {
    const opened: string[] = [];
    const { engine, request, emit } = engineOf(ALL, (m) => (m === "config.get" ? { hash: "h", valid: true, config: { security: { lockdown: true } } } : m.endsWith(".list") ? [] : {}));
    await render(engine, <ApprovalsLayer engine={engine} sessionKey={null} view="other" onOpen={(k) => opened.push(k)} />);
    expect(document.querySelector("[data-testid=r1-lock]")?.textContent).toContain("Lockdown is on.");
    await emit("plugin.approval.requested", EMAIL);
    const banner = document.querySelector("[data-testid=r1-banner]")!;
    expect([...banner.querySelectorAll(".r1-banner-acts button")].map((b) => b.textContent)).toEqual(["Yes", "No", "Open"]);
    expect((button(banner, "Yes") as HTMLButtonElement).disabled).toBe(true);
    await click(button(banner, "Open"));
    expect(opened).toEqual(["agent:ledger:main"]);
    await click(button(document.querySelector("[data-testid=r1-lock]")!, "Turn it off"));
    expect(request).toHaveBeenCalledWith("config.patch", { raw: JSON.stringify({ security: { lockdown: false } }), baseHash: "h" });
  });

  it("Turn it off clears Lockdown for real: the patch goes out and the notice leaves", async () => {
    let lockdown = true;
    const { engine, request } = engineOf(ALL, (m) => {
      if (m === "config.get") return { hash: "h", valid: true, config: { security: { lockdown } } };
      if (m === "config.patch") { lockdown = false; return { ok: true, hash: "h2", config: { security: { lockdown: false } } }; }
      return m.endsWith(".list") ? [] : {};
    });
    await render(engine, <ApprovalsLayer engine={engine} sessionKey={null} view="other" onOpen={() => undefined} />);
    const notice = document.querySelector("[data-testid=r1-lock]")!;
    expect(notice).not.toBeNull();
    await click(button(notice, "Turn it off"));
    expect(request).toHaveBeenCalledWith("config.patch", expect.objectContaining({ raw: JSON.stringify({ security: { lockdown: false } }) }));
    expect(document.querySelector("[data-testid=r1-lock]")).toBeNull();
  });

  it("keeps at most three banners, newest on top, and each leaves on its own after 6 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gone: string[] = [];
    const items = ["a", "b", "c", "d"].map((id) => ({ id, title: id }));
    const { engine } = engineOf([]);
    await render(engine, <Banners items={items} onDismiss={(id) => gone.push(id)} />);
    expect([...document.querySelectorAll("[data-testid=r1-banner] b")].map((b) => b.textContent)).toEqual(["a", "b", "c"]);
    expect(gone).toEqual(["d"]);
    await act(async () => { vi.advanceTimersByTime(6000 + 400); });
    expect(gone.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("lists answered approvals and standing grants, and takes a grant back", async () => {
    const { engine, request } = engineOf(["approval.history", "exec.approval.grants.list", "exec.approval.grants.revoke"], (m, params) => (
      m === "approval.history" ? { items: [{ id: (params as { cursor?: string }).cursor ? "a2" : "a1", status: "denied", decision: "deny", reason: "user", resolvedAtMs: 5, presentation: { kind: "plugin", title: "Send this email?" } }], nextCursor: "c2" }
        : m === "exec.approval.grants.list" ? { grants: [{ grantId: "g1", command: "backup.sh", cronJobId: "j", cronJobName: "Nightly backup", useCount: 3, revokedAtMs: null }] } : { outcome: "revoked" }));
    const host = await render(engine, <AskHistory engine={engine} />);
    expect(host.textContent).toContain("✕ Declined");
    expect(host.textContent).toContain("Nightly backup");
    await click(button(host, "Show more"));
    expect(request).toHaveBeenCalledWith("approval.history", { limit: 20, cursor: "c2" });
    await click(button(host, "Take back"));
    expect(request).toHaveBeenCalledWith("exec.approval.grants.revoke", { grantId: "g1" });
  });
});
