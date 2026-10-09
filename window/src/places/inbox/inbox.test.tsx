// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { loadNeeds, markRead, refreshesInbox } from "./data";
import { openInboxWith } from "./handoff";
import { InboxPlace, useNeedsCount } from "./index";
import { FULL_ACCESS_GAP } from "./NeedsYou";
import { session } from "../overview/engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));

const NOW = Date.now(), M = 6e4, H = 36e5;
const iso = (t: number) => new Date(t).toISOString();
const FX: Record<string, unknown> = {
  "exec.approval.list": [{ id: "x1", expiresAtMs: NOW + 50 * M, request: { title: "Run this command?", agentId: "main", sessionKey: "agent:main:a" } }],
  "plugin.approval.list": [{ id: "x2", expiresAtMs: NOW + 50 * M, request: { title: "Install a tool?", agentId: "main" } }],
  "branch.approval.list": [],
  "channels.pairing.list": { accounts: [], requests: [{ requestId: "q1", channel: "telegram", channelLabel: "Telegram", accountId: "default", senderId: "1", senderLabel: "Jordan Ellis", createdAt: iso(NOW - 4 * M), lastSeenAt: iso(NOW), expiresAt: iso(NOW + 56 * M), notifySupported: true }], commandOwnerConfigured: false },
  "device.pair.list": { pending: [{ requestId: "d1", deviceId: "dev", displayName: "Phone", platform: "Android", scopes: ["operator.read"], ts: NOW - 3 * M }] },
  "node.pair.list": { pending: [{ requestId: "n1", nodeId: "box", displayName: "box", commands: ["system.run"] }] },
  "question.list": { questions: [{ id: "qq", status: "pending", agentId: "main", sessionKey: "agent:main:a", expiresAtMs: NOW + 20 * M, questions: [{ questionId: "which", header: "Folder", question: "Which folder first?", options: [{ label: "Downloads" }, { label: "Desktop" }] }] }, { id: "old", status: "answered", questions: [] }] },
  "mentions.list": { items: [{ id: "m1", senderLabel: "Dana Ruiz", sessionKey: "agent:main:a", sessionTitle: "Month-end", createdAt: NOW - 40 * M, excerpt: "can you confirm?" }] },
  "cron.list": { jobs: [{ id: "j1", name: "Receipts sweep", state: { lastRunStatus: "error", lastRunAtMs: NOW - H, lastError: "folder moved" } }] },
  "models.authStatus": { providers: [{ displayName: "Claude", status: "expired" }, { displayName: "Other", status: "ok" }] },
  "channels.status": { channelLabels: { telegram: "Telegram" }, channelAccounts: { telegram: [{ accountId: "default", configured: true, running: false, lastError: "token revoked" }] } },
  "sessions.list": { sessions: [
    { key: "agent:main:a", agentId: "main", label: "Main", updatedAt: NOW },
    { key: "agent:main:done", agentId: "main", label: "Finished one", status: "done", lastRunId: "r1", unread: true, updatedAt: NOW - H, activitySummary: { state: "current", text: "All tidy." }, owner: { actor: { type: "human", id: "p1" } } },
    { key: "agent:main:other", agentId: "main", label: "Someone else's", status: "done", lastRunId: "r2", updatedAt: NOW - 2 * H, owner: { actor: { type: "human", id: "p2" } } },
  ] },
  "agents.list": { defaultId: "main", mainKey: "home", agents: [{ id: "main", identity: { name: "Rowan" } }] },
  "audit.activity.list": { events: [{ kind: "agent_run", action: "agent.run.started", runId: "r1", agentId: "main", sessionKey: "agent:main:done", occurredAt: NOW - H }, { kind: "agent_run", action: "agent.run.finished", runId: "r1", agentId: "main", sessionKey: "agent:main:done", occurredAt: NOW - H + 72000, status: "succeeded" }] },
  "users.list": { profiles: [{ id: "p1", displayName: "Robin" }, { id: "p2", displayName: "Dana Ruiz" }] },
  "users.self": { profile: { id: "p1" } },
  "audit.run.inspect": { schemaVersion: 1, run: { runId: "r1", status: "known" }, identity: { state: "unknown", reasonCode: "no-record", missingEvidence: ["invoker"] }, decisionDisplays: [], coverage: { state: "unattributed", missingEvidence: [] } },
  "worktrees.list": { worktrees: [] },
};

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });

const engineWith = (request: WindowEngine["request"], scopes = ["operator.admin"]): WindowEngine => ({ request, onEvent: () => () => {}, sessionKey: null, scopes });
function withoutUnrequestedRecaps(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("sessions" in value) || !Array.isArray(value.sessions)) return value;
  return { ...value, sessions: value.sessions.map(row => {
    if (!row || typeof row !== "object" || !("activitySummary" in row)) return row;
    const { activitySummary, ...rest } = row;
    void activitySummary;
    return rest;
  }) };
}
async function render({ level = "regular" as Level, scopes = ["operator.admin"], fx = FX, strictRecapProjection = false } = {}) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const requested = params !== null && typeof params === "object" && "includeActivitySummary" in params && params.includeActivitySummary === true;
    const v = strictRecapProjection && method === "sessions.list" && !requested ? withoutUnrequestedRecaps(fx[method]) : fx[method];
    if (v && typeof v === "object" && "__error" in v) throw new Error(String((v as { __error: string }).__error));
    return v ?? {};
  });
  const openConversation = vi.fn(), openPlace = vi.fn(), openSettings = vi.fn();
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<InboxPlace engine={engineWith(request as WindowEngine["request"], scopes)} facts={{ running: 0, waiting: 0 }} level={level} openConversation={openConversation} openPlace={openPlace} openSettings={openSettings} />));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { host, request, openConversation, openPlace, openSettings };
}
const btn = (host: ParentNode, label: string) => [...host.querySelectorAll("button")].filter(b => b.textContent?.trim() === label);
const click = async (b: HTMLElement | undefined) => { await act(async () => { b!.click(); await new Promise(r => setTimeout(r, 0)); }); };
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);

describe("Inbox data", () => {
  it("skips pairing and question reads the connection has no scope for", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({}));
    await loadNeeds(engineWith(request as WindowEngine["request"], ["operator.read"]));
    const methods = request.mock.calls.map(([m]) => m);
    expect(methods).not.toContain("channels.pairing.list");
    expect(methods).not.toContain("question.list");
    expect(methods).toContain("mentions.list");
  });
  it("marks conversations read in batches of 100", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({}));
    const list = Array.from({ length: 150 }, (_, i) => session({ key: `k${i}`, agentId: "main" }));
    await markRead(engineWith(request as WindowEngine["request"]), list);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(["sessions.patchMany", { targets: list.slice(100).map(s => ({ key: s.key, agentId: "main" })), patch: { unread: false } }]);
  });
  it("reports a conversation the engine refused to mark read", async () => {
    const request = vi.fn(async () => ({ outcomes: [{ ok: true, key: "a" }, { ok: false, key: "b", error: { message: "not yours" } }] }));
    await expect(markRead(engineWith(request as WindowEngine["request"]), [session({ key: "a" }), session({ key: "b" })])).rejects.toThrow("1 conversation couldn’t be marked read: not yours.");
  });
  it("refreshes on mentions, questions and pairing events", () => {
    for (const e of ["mentions.changed", "question.requested", "device.pair.requested", "node.pair.resolved", "exec.approval.requested"]) expect(refreshesInbox(e)).toBe(true);
  });
});

describe("Inbox › Needs you", () => {
  it("lists a Trunk waiting for an answer under Recent notices, and opens its conversation", async () => {
    const { host, openConversation, openSettings } = await render();
    const bell = host.querySelector<HTMLButtonElement>('button[aria-label="Recent notices"]');
    await click(bell!);
    const pop = document.querySelector('[data-testid="inbox-notices"]');
    expect(pop?.textContent).toContain("Rowan is waiting for your answer.");
    await click(btn(document, "Rowan is waiting for your answer.")[0]);
    expect(openConversation).toHaveBeenCalledWith("agent:main:a");
    await click(bell!);
    await click(btn(document, "Notification settings")[0]);
    expect(openSettings).toHaveBeenCalledWith("notifications");
  });
  it("says so when there are no notices", async () => {
    const { host } = await render({ fx: { ...FX, "question.list": { questions: [] } } });
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Recent notices"]')!);
    expect(document.querySelector('[data-testid="inbox-notices"]')?.textContent).toContain("No notices right now.");
  });
  it("counts approvals, requests and questions in the chip, and Allow all only the approvals", async () => {
    const { host } = await render();
    expect(host.querySelector(".ib-n")?.textContent).toBe("6");
    expect(btn(host, "Allow all 2…")).toHaveLength(1);
  });
  it("reviews only the two approvable actions in a dialog before allowing them", async () => {
    const { host, request } = await render({ fx: { ...FX, "approval.resolve": { applied: true } } });
    await click(btn(host, "Allow all 2…")[0]);
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.textContent).toContain("Allow all 2?");
    expect([...dialog.querySelectorAll(".allow18D li")].map(row => row.textContent)).toEqual(["Rowan: Run this command", "Rowan: Install a tool"]);
    expect(dialog.textContent).not.toContain("Jordan Ellis");
    expect(dialog.textContent).toContain("Each Trunk still asks next time.");
    await click(btn(dialog, "Cancel")[0]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(calls(request, "approval.resolve")).toHaveLength(0);
    await click(btn(host, "Allow all 2…")[0]);
    await click(btn(document.querySelector("[role=dialog]")!, "Allow all 2")[0]);
    expect(calls(request, "approval.resolve")).toEqual([{ id: "x1", kind: "exec", decision: "allow-once" }, { id: "x2", kind: "plugin", decision: "allow-once" }]);
  });
  it("draws the status cards from the engine and greys what it cannot back", async () => {
    const { host, request } = await render({ scopes: ["operator.read", "operator.approvals", "operator.pairing", "operator.questions", "operator.write"] });
    const text = host.textContent ?? "";
    expect(text).toContain("Telegram stopped: token revoked");
    expect(text).toContain("Receipts sweep failed");
    expect(text).toContain("Your Claude sign-in expired");
    expect(btn(host, "Ask for full access")[0]).toMatchObject({ disabled: true, title: FULL_ACCESS_GAP });
    expect(btn(host, "Turn Telegram off")[0].disabled).toBe(true);
    expect(calls(request, "cron.list")[0]).toMatchObject({ lastRunStatus: "error", enabled: "enabled" });
  });
  it("Ask <Trunk> drafts the card's question into the default Trunk's main conversation and opens it", async () => {
    const { host, openConversation } = await render();
    const heard: unknown[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener("branch:compose", listen);
    const card = (title: string) => [...host.querySelectorAll(".ib-card")].find(c => c.textContent?.includes(title))!;
    await click(btn(card("Receipts sweep failed"), "Ask Rowan")[0]);
    await click(btn(card("sign-in expired"), "Ask Rowan")[0]);
    window.removeEventListener("branch:compose", listen);
    expect(heard).toEqual([
      { sessionKey: "agent:main:home", text: "These automations failed: Receipts sweep (folder moved). Explain why and how to fix them." },
      { sessionKey: "agent:main:home", text: "These sign-ins expired: Claude. Explain what stops working and how to sign in again." },
    ]);
    expect(openConversation).toHaveBeenCalledWith("agent:main:home");
  });
  it("answers a chat-app request with the review choices", async () => {
    const { host, request } = await render();
    await click(btn(host, "Review")[0]);
    const dialog = document.querySelector("[role=dialog]")!;
    const boxes = dialog.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    await click(boxes[0]); await click(boxes[1]);
    await click(btn(dialog, "Allow")[0]);
    expect(calls(request, "channels.pairing.approve")).toEqual([{ channel: "telegram", accountId: "default", requestId: "q1", notify: true, bootstrapCommandOwner: true }]);
  });
  it("sends dismiss, device reject and node approve with the request id", async () => {
    const { host, request } = await render();
    const row = (title: string) => [...host.querySelectorAll(".ib-row")].find(r => r.textContent?.includes(title))!;
    await click(btn(row("Jordan Ellis"), "Don’t allow")[0]);
    await click(btn(row("Phone wants to connect"), "Don’t allow")[0]);
    await click(btn(row("box wants to offer"), "Allow")[0]);
    expect(calls(request, "channels.pairing.dismiss")).toEqual([{ channel: "telegram", accountId: "default", requestId: "q1" }]);
    expect(calls(request, "device.pair.reject")).toEqual([{ requestId: "d1" }]);
    expect(calls(request, "node.pair.approve")).toEqual([{ requestId: "n1" }]);
  });
  it("shows the device check code beside the access request", async () => {
    const { host } = await render();
    const row = [...host.querySelectorAll(".ib-row")].find(r => r.textContent?.includes("Phone wants to connect"))!;
    await click(btn(row, "Allow")[0]);
    expect(host.querySelector(".dlg")?.textContent).toContain("Check code: D1");
    expect(host.querySelector(".dlg")?.textContent).toContain("What it asks to do");
  });
  it("answers and skips a Trunk's question", async () => {
    const { host, request } = await render();
    await click(btn(host, "Desktop")[0]);
    await click(btn(host, "Skip")[0]);
    expect(calls(request, "question.resolve")).toEqual([{ id: "qq", answers: { answers: { which: ["Desktop"] } } }, { id: "qq", cancel: true }]);
  });
  it("dismisses a mention, and opens its conversation", async () => {
    const { host, request, openConversation } = await render();
    await click(btn(host, "Dismiss")[0]);
    expect(calls(request, "mentions.dismiss")).toEqual([{ ids: ["m1"] }]);
    const open = btn(host.querySelector(".ib-sec")!, "Open")[0];
    await click(open);
    expect(openConversation).toHaveBeenCalledWith("agent:main:a");
  });
  it("marks unread conversations read", async () => {
    const { host, request } = await render();
    await click(btn(host, "Mark all read")[0]);
    expect(calls(request, "sessions.patchMany")).toEqual([{ targets: [{ key: "agent:main:done", agentId: "main" }], patch: { unread: false } }]);
  });
  it("shows Branch's pending self-improvements and opens Customize to review them", async () => {
    const { host, openPlace } = await render({ fx: { ...FX, "skills.proposals.list": { proposals: [{ id: "s1", status: "pending", kind: "update", title: "Skip open files when tidying" }, { id: "s2", status: "applied", title: "Old" }] } } });
    expect(host.querySelector(".ib-n")?.textContent).toBe("7");
    const row = [...host.querySelectorAll(".ib-row")].find(r => r.textContent?.includes("Branch wants to improve itself"))!;
    expect(row.textContent).toContain("Skip open files when tidying · a change to a skill · waiting for you");
    await click(btn(row, "Review")[0]);
    expect(openPlace).toHaveBeenCalledWith("customize");
  });
  it("shows the empty line when nothing waits", async () => {
    const { host } = await render({ fx: { ...FX, "exec.approval.list": [], "plugin.approval.list": [], "channels.pairing.list": {}, "device.pair.list": {}, "node.pair.list": {}, "question.list": {} } });
    expect(host.textContent).toContain("Nothing is waiting for you. Trunks show up here when they need a yes.");
  });
});

describe("useNeedsCount", () => {
  function Probe({ engine }: { engine: WindowEngine }) { return <span data-testid="n">{useNeedsCount(engine)}</span>; }
  it("counts exactly what the chip counts, reads only those sources, and refreshes on Inbox events after 150 ms", async () => {
    let listener: ((e: { event: string }) => void) | undefined;
    const fx: Record<string, unknown> = { ...FX, "skills.proposals.list": { proposals: [{ id: "s", status: "pending" }] } };
    const request = vi.fn(async (method: string) => fx[method] ?? {});
    const engine: WindowEngine = { request: request as WindowEngine["request"], sessionKey: null, scopes: ["operator.admin"], onEvent: cb => { listener = cb as typeof listener; return () => { listener = undefined; }; } };
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root!.render(<Probe engine={engine} />));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toBe("7");
    expect(new Set(request.mock.calls.map(([m]) => m))).toEqual(new Set(["exec.approval.list", "plugin.approval.list", "branch.approval.list", "skills.proposals.list", "channels.pairing.list", "device.pair.list", "node.pair.list", "question.list"]));
    fx["exec.approval.list"] = [];
    vi.useFakeTimers();
    listener?.({ event: "exec.approval.resolved" });
    await act(async () => { vi.advanceTimersByTime(150); });
    vi.useRealTimers();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toBe("6");
  });
  it("skips pairing and question sources without their scopes, and counts 0 when every read fails", async () => {
    const request = vi.fn(async (_method: string): Promise<unknown> => { throw new Error("offline"); });
    const engine: WindowEngine = { request: request as WindowEngine["request"], sessionKey: null, scopes: ["operator.read"], onEvent: () => () => {} };
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root!.render(<Probe engine={engine} />));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toBe("0");
    expect(request.mock.calls.map(([m]) => m)).not.toContain("device.pair.list");
  });
});

describe("Inbox › other tabs", () => {
  it("requests stored History recaps through the real list option without generating them", async () => {
    const { host, request } = await render({ strictRecapProjection: true });
    await click(btn(host, "History")[0]);
    expect(request).toHaveBeenCalledWith("sessions.list", expect.objectContaining({ includeActivitySummary: true }));
    expect(host.textContent).toContain("All tidy.");
    expect(calls(request, "sessions.activitySummary.ensure")).toHaveLength(0);
  });
  it("does not claim verified integrity or signed receipts from ordinary recorded activity", async () => {
    const { host, request } = await render();
    await click(btn(host, "History")[0]);
    expect(host.textContent).not.toMatch(/Record intact|Every tool call leaves a signed receipt|nothing can be cut or rewritten quietly/i);
    expect(host.querySelector(".ib-rec")).toBeNull();
    expect(btn(host, "See the chain")).toHaveLength(0);
    expect(calls(request, "audit.run.inspect")).toHaveLength(0);
    expect(calls(request, "sessions.activitySummary.ensure")).toHaveLength(0);
  });
  it("lists finished conversations with their recap and an unread dot", async () => {
    const { host } = await render();
    await click(btn(host, "Finished")[0]);
    expect(host.textContent).toContain("Finished one");
    expect(host.textContent).toContain("Rowan · All tidy.");
    expect(host.querySelectorAll(".ib-udot")).toHaveLength(1);
  });
  it("switches tab on the branch:place-tab window event for the Inbox only", async () => {
    const { host } = await render();
    const send = async (place: string, tab: string) => act(async () => { window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place, tab } })); });
    await send("automations", "Later");
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toContain("Needs you");
    await send("inbox", "Later");
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Later");
    await send("inbox", "history");
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("History");
  });
  it("Later shows its empty wording and no greyed Messages stub", async () => {
    const { host } = await render();
    await click(btn(host, "Later")[0]);
    expect(host.textContent).toContain("Nothing is waiting to finish later.");
    expect(host.querySelector("input[placeholder='Search messages']")).toBeNull();
    expect(visibleDevNotes(host)).toEqual([]);
  });
  it("History groups by day with run lengths; Every conversation only from Advanced; the run menu only at Technical", async () => {
    const regular = await render();
    await click(btn(regular.host, "History")[0]);
    expect(regular.host.textContent).toContain("1m 12s");
    expect(regular.host.textContent).toContain("Today");
    expect(btn(regular.host, "Watch again")).toHaveLength(0);
    expect(visibleDevNotes(regular.host)).toEqual([]);
    expect(regular.host.textContent).not.toContain("Every conversation");
    expect(regular.host.querySelector(".ib-hrow .ib-ib")).toBeNull();
    await act(async () => root?.unmount()); root = undefined;
    const advanced = await render({ level: "advanced" });
    await click(btn(advanced.host, "History")[0]);
    expect(advanced.host.textContent).toContain("Every conversation");
    expect(advanced.host.querySelector(".ib-hrow .ib-ib")).toBeNull();
  });
  it("looks inside a run with audit.run.inspect at Technical", async () => {
    const { host, request } = await render({ level: "technical" });
    await click(btn(host, "History")[0]);
    await click(host.querySelector<HTMLElement>(".ib-hrow .ib-ib")!);
    await click([...document.querySelectorAll<HTMLElement>("button.mi")].find(b => b.textContent?.includes("Look inside this run")));
    expect(calls(request, "audit.run.inspect")).toEqual([{ runId: "r1" }]);
    expect(document.body.textContent).toContain("Nothing was recorded for invoker.");
  });
  it("falls back to audit.list when the activity record is missing, and opens filtered to a handed-off person", async () => {
    openInboxWith({ tab: "history", people: ["p2"] });
    const { host, request } = await render({ fx: { ...FX, "audit.activity.list": { __error: "unknown method" }, "audit.list": FX["audit.activity.list"] } });
    expect(calls(request, "audit.list")).toEqual([{ kind: "agent_run", limit: 500 }]);
    expect(host.textContent).toContain("Someone else's");
    expect(host.textContent).not.toContain("Finished one");
  });
});
