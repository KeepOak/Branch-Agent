// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { PeoplePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

type Answer = unknown | ((params: Record<string, unknown>) => unknown);
/** An engine answering each method from a table; a method missing from it fails like an unknown method. */
export function fakeEngine(table: Record<string, Answer>, scopes = ["operator.admin"]) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (!(method in table)) throw new Error(`unknown method ${method}`);
    const answer = table[method];
    const value = typeof answer === "function" ? (answer as (p: Record<string, unknown>) => unknown)(params) : answer;
    if (value instanceof Error) throw value;
    return value;
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes };
  return { engine, request };
}
export async function mount(engine: WindowEngine, level: Level = "regular") {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<PeoplePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={opened} openPlace={() => {}} openSettings={() => {}} level={level} />); });
  await act(async () => { await Promise.resolve(); });
}
export const opened = vi.fn();
export const button = (label: string) => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
export async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => { b!.click(); }); await act(async () => { await Promise.resolve(); }); }
export const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);

export const BASE = {
  "users.list": { profiles: [{ id: "gateway-owner", displayName: "Rowan Vale", emails: [], mergedInto: null }, { id: "p-mira", displayName: "Mira Stone", emails: ["mira@home.test"], mergedInto: null, role: "adult" }] },
  "users.self": { profile: { id: "gateway-owner", displayName: "Rowan Vale", emails: [], mergedInto: null } },
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "books", identity: { name: "Abacus" } }] },
  "system-presence": [{ user: { id: "p-mira", name: "Mira Stone" }, host: "Mira's laptop", ip: "192.168.1.40", lastInputSeconds: 30, ts: 1, version: "0.19.4", watchedSessions: [] }],
};

describe("People › Live now", () => {
  const sessions = (p: Record<string, unknown>) => p.includeOwnerSessionCounts
    ? { sessions: [], ownerSessionCounts: [{ profileId: "p-mira", open: 2, running: 1 }] }
    : { sessions: [
      { key: "agent:books:a", agentId: "books", label: "Reconcile the card statement", hasActiveRun: true, visibility: "shared", model: "local-model", owner: { actor: { type: "human", id: "p-mira", label: "Mira Stone" } } },
      { key: "agent:main:b", agentId: "main", label: "Tidy the downloads", hasActiveRun: true, owner: { actor: { type: "human", id: "gateway-owner" } } },
    ] };

  it("shows who is online with the engine's activity and counts, and a card per run", async () => {
    const { engine, request } = fakeEngine({ ...BASE, "sessions.list": sessions });
    await mount(engine);
    expect(request).toHaveBeenCalledWith("users.list", {});
    expect(calls(request, "sessions.list")).toContainEqual({ activeOnly: true, includeDerivedTitles: true, includeLastMessage: true });
    expect(calls(request, "sessions.list")).toContainEqual({ limit: 1, includeOwnerSessionCounts: true });
    const strip = host.querySelector('[role="group"]')!;
    expect(strip.textContent).toContain("Mira"); expect(strip.textContent).toContain("2 open · 1 running");
    expect(strip.querySelector('[aria-label="Active"]')).toBeTruthy();
    expect(host.querySelectorAll(".pp-run")).toHaveLength(2);
    expect(host.textContent).toContain("Reconcile the card statement"); expect(host.textContent).toContain("shared");
    const ask = button("Ask to join")!; expect(ask.disabled).toBe(true); expect(ask.title).toBe(""); expect(visibleDevNotes(host)).toEqual([]);
    await click("Open"); expect(opened).toHaveBeenCalledWith("agent:main:b");
    expect(host.querySelector('[role="tablist"][aria-label="Team"] [aria-selected="true"]')!.textContent).toBe("Live now2");
  });

  it("watches a run read-only through the engine's preview", async () => {
    const { engine, request } = fakeEngine({ ...BASE, "sessions.list": sessions, "sessions.preview": { previews: [{ key: "agent:books:a", status: "ok", items: [{ role: "tool", text: "Opened the statement" }, { role: "assistant", text: "Matching receipts" }] }] } });
    await mount(engine);
    await click("Watch");
    expect(request).toHaveBeenCalledWith("sessions.preview", { keys: ["agent:books:a"], limit: 12, maxChars: 240 });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Mira’s Abacus");
    expect(dialog.textContent).toContain("Opened the statement"); expect(dialog.textContent).toContain("Read-only.");
  });

  it("draws one card per run and leaves helpers inside their parent run", async () => {
    const helper = { key: "agent:books:h", agentId: "books", label: "Read the receipts", spawnedBy: "agent:books:a", hasActiveRun: true };
    const withHelper = (p: Record<string, unknown>) => { const v = sessions(p); return p.includeOwnerSessionCounts ? v : { sessions: [...v.sessions, helper] }; };
    const { engine } = fakeEngine({ ...BASE, "sessions.list": withHelper });
    await mount(engine);
    expect(host.querySelectorAll(".pp-run")).toHaveLength(2);
    expect(host.textContent).not.toContain("Read the receipts");
  });
  it("says nothing is running when the engine has no active runs, and shows the banner", async () => {
    const { engine } = fakeEngine({ ...BASE, "system-presence": [], "sessions.list": { sessions: [] } });
    await mount(engine);
    expect(host.textContent).toContain("Nothing is running right now.");
    expect(host.textContent).toContain("Your keepoak.com team is optional");
    expect(host.querySelector('[role="group"][aria-label]')).toBeNull();
  });
});

describe("People › People", () => {
  const CONFIG = { hash: "h", valid: true, config: { gateway: { roles: { definitions: { adult: { agents: ["books"], sessions: { others: "view" }, scopes: [] }, child: { agents: "*", sessions: { others: "none" }, scopes: [] } } } } } };
  const table = (extra: Record<string, Answer> = {}) => ({ ...BASE, "config.get": CONFIG, "sessions.list": { sessions: [] }, ...extra });

  it("lists people by how they reach Branch and shows the selected person's card", async () => {
    const { engine } = fakeEngine(table());
    await mount(engine); await click("People2");
    expect([...host.querySelectorAll(".pp-grp")].map(g => g.textContent)).toEqual(["On this computer", "On their own device"]);
    expect(host.querySelector(".pp-item[aria-current='true']")!.textContent).toContain("Mira Stone");
    const card = host.querySelector(".pp-detail")!;
    expect(card.textContent).toContain("Online · active"); expect(card.textContent).toContain("Mira's laptop");
    expect(card.textContent).toContain("books"); expect(card.textContent).not.toContain("PIN"); expect(visibleDevNotes(card)).toEqual([]);
    const ticks = [...card.querySelectorAll<HTMLInputElement>(".pp-may input")]; expect(ticks).toHaveLength(7); expect(ticks.every(t => t.disabled)).toBe(true);
    expect(button("Switch to Mira")!.disabled).toBe(true); expect(button("Remove")!.disabled).toBe(true); expect(button("Remove")!.title).toBe("");
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("sets a role the engine defines through users.setRole", async () => {
    const { engine, request } = fakeEngine(table({ "users.setRole": { profile: {} } }));
    await mount(engine); await click("People2"); await click("child");
    expect(request).toHaveBeenCalledWith("users.setRole", { profileId: "p-mira", role: "child" });
    await click("No role"); expect(request).toHaveBeenCalledWith("users.setRole", { profileId: "p-mira", role: null });
  });

  it("greys the role when the engine defines no roles", async () => {
    const { engine } = fakeEngine(table({ "config.get": { hash: "h", config: {} } }));
    await mount(engine); await click("People2");
    expect(button("No role")!.disabled).toBe(true); expect(button("No role")!.title).toBe(""); expect(visibleDevNotes(host)).toEqual([]);
  });

  it("makes a limited one-time code and says how long it works", async () => {
    const { engine, request } = fakeEngine(table({ "device.pair.setupCode": { setupCode: "CODE-123", qrDataUrl: "data:image/png;base64,AA==", gatewayUrl: "wss://home.test", auth: "token", urlSource: "x", expiresAtMs: Date.now() + 10 * 60_000 } }));
    await mount(engine); await click("People2"); await click("Make a one-time code");
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => { (dialog.querySelector(".dlg-f .btn.pri") as HTMLButtonElement).click(); });
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { bootstrapProfile: "limited", includeQr: true });
    expect(dialog.querySelector("img")?.getAttribute("alt")).toBe("One-time code as a QR code");
    expect(dialog.textContent).toContain("CODE-123"); expect(dialog.textContent).toContain("Works once, for 10 minutes.");
  });

  it("shows Link an email and Merge from Advanced, and the profile id only at Technical", async () => {
    let r = fakeEngine(table()); await mount(r.engine, "regular"); await click("People2");
    expect(button("Link an email…")).toBeUndefined(); expect(host.querySelector(".pp-id")).toBeNull();
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    r = fakeEngine(table({ "users.merge": { profile: {}, movedAliasKinds: [] }, "users.linkEmail": { profile: {} } })); await mount(r.engine, "advanced"); await click("People2");
    expect(host.querySelector(".pp-id")).toBeNull();
    await click("Link an email…");
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "mira@work.test"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Link"); expect(r.request).toHaveBeenCalledWith("users.linkEmail", { email: "mira@work.test", targetProfileId: "p-mira" });
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    r = fakeEngine(table()); await mount(r.engine, "technical"); await click("People2");
    expect(host.querySelector(".pp-id code")!.textContent).toBe("p-mira");
  });

  it("offers Make a one-time code from the invite dialog and greys the other ways in", async () => {
    const { engine } = fakeEngine(table());
    await mount(engine); await click("People2"); await click("Invite someone");
    expect(button("Add them")!.disabled).toBe(true); expect(button("Add them")!.title).toBe("");
    expect(document.querySelector<HTMLFieldSetElement>('[role="dialog"] fieldset')!.disabled).toBe(true);
    expect(visibleDevNotes(document.querySelector('[role="dialog"]')!)).toEqual([]);
    await click("From your keepoak.com team"); expect(button("Invite")!.disabled).toBe(true);
    await click("On their own device"); expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Make a one-time code");
  });
});

describe("People › Groups", () => {
  it("never shows conversation groups as permission groups: empty line and a greyed New group", async () => {
    const { engine, request } = fakeEngine({ ...BASE, "sessions.list": { sessions: [{ key: "agent:main:x", group: "Work", label: "In a folder" }] } });
    await mount(engine); await click("Access"); await click("Access groups");
    expect(host.textContent).toContain("Being in a group can only take things away.");
    expect(host.textContent).toContain("No groups yet."); expect(host.textContent).not.toContain("Work");
    expect(button("New group")!.disabled).toBe(true); expect(button("New group")!.title).toBe(""); expect(visibleDevNotes(host)).toEqual([]);
    expect(request.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("People › Shared", () => {
  const LIST = { sessions: [
    { key: "agent:main:open", sessionId: "s1", label: "Garden plans", visibility: "shared", sharingRole: "owner" },
    { key: "agent:main:mine", sessionId: "s2", label: "Private notes", visibility: "draft", sharingRole: "owner" },
    { key: "agent:main:theirs", label: "Close notes", visibility: "shared", sharingRole: "member", owner: { actor: { type: "human", id: "p-mira", label: "Mira" } } },
  ] };
  const members = (p: Record<string, unknown>) => ({ sessionKey: p.sessionKey, members: [{ identityId: "p-mira", addedBy: "x", addedAt: 1 }], identities: [{ type: "human", id: "p-mira", displayName: "Mira Stone" }, { type: "human", id: "p-june", displayName: "June Park" }], role: "owner", allowedVisibilities: ["draft", "read-only", "shared"], ...(p.sessionKey === "agent:main:mine" ? { publicShare: { token: "v1.abc", createdAt: 1_700_000_000_000 } } : {}) });
  const table = { ...BASE, "sessions.list": LIST, "session.members.list": members, "session.visibility.set": { ok: true }, "session.members.remove": { ok: true }, "session.members.add": { ok: true }, "session.publicShare.set": { ok: true } };

  it("lists what you share, what others share with you, and opens theirs", async () => {
    const { engine } = fakeEngine(table);
    await mount(engine); await click("Access"); await click("Shared");
    expect(host.textContent).toContain("Garden plans"); expect(host.textContent).toContain("Everyone on this Branch may write in it");
    expect(host.textContent).toContain("Mira: Close notes"); expect(host.textContent).toContain("you may read it and write in it");
    await click("Open"); expect(opened).toHaveBeenCalledWith("agent:main:theirs");
  });

  it("manages who has it and how far it is shared", async () => {
    const { engine, request } = fakeEngine(table);
    await mount(engine); await click("Access"); await click("Shared"); await click("Manage");
    expect(request).toHaveBeenCalledWith("session.members.list", { sessionKey: "agent:main:open" });
    await click("May read it"); expect(request).toHaveBeenCalledWith("session.visibility.set", { sessionKey: "agent:main:open", visibility: "read-only" });
    await click("Remove"); expect(request).toHaveBeenCalledWith("session.members.remove", { sessionKey: "agent:main:open", identityId: "p-mira" });
    await click("Add"); expect(request).toHaveBeenCalledWith("session.members.add", { sessionKey: "agent:main:open", identityId: "p-june" });
  });

  it("stops a public link with the conversation's id", async () => {
    const { engine, request } = fakeEngine(table);
    await mount(engine); await click("Access"); await click("Shared");
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toContain("Private notes"); expect(host.textContent).toContain("A copy");
    await click("Stop this link");
    expect(request).toHaveBeenCalledWith("session.publicShare.set", { sessionKey: "agent:main:mine", expectedSessionId: "s2", enabled: false });
    expect(host.textContent).not.toContain("Stop this link");
  });

  it("says nothing is shared, and shows Snapshots greyed from Advanced", async () => {
    const { engine } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] } });
    await mount(engine, "advanced"); await click("Access"); await click("Shared");
    expect(host.textContent).toContain("Nothing is shared yet.");
    const sw = host.querySelector('[role="switch"][aria-label="Snapshots"]') as HTMLButtonElement; expect(sw.disabled).toBe(true);
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    await mount(fakeEngine({ ...BASE, "sessions.list": { sessions: [] } }).engine, "regular"); await click("Access"); await click("Shared");
    expect(host.textContent).not.toContain("Snapshots sent to you");
  });
});

describe("People › Teams of specialists", () => {
  it("draws a read-only card per team task from the engine's swarm summary", async () => {
    const list = { sessions: [
      { key: "agent:main:lead", agentId: "main", label: "Month-end close", owner: { actor: { type: "human", id: "p-mira", label: "Mira" } }, swarm: { otherActiveGroups: 0, groups: [{ groupId: "g1", createdAt: 1, queued: 1, running: 1, done: 0, failed: 0, children: [{ sessionKey: "agent:books:c1", status: "running" }, { sessionKey: "agent:main:c2", status: "queued" }] }] } },
      { key: "agent:books:c1", agentId: "books", label: "Finding receipts" },
      { key: "agent:main:old", agentId: "main", label: "Finished team", swarm: { otherActiveGroups: 0, groups: [{ groupId: "g0", createdAt: 1, queued: 0, running: 0, done: 2, failed: 0 }] } },
    ] };
    const { engine } = fakeEngine({ ...BASE, "sessions.list": list });
    await mount(engine); await click("Teams");
    const card = host.querySelector(".pp-team")!;
    expect(host.querySelectorAll(".pp-team")).toHaveLength(1);
    expect(card.textContent).toContain("Working · round 1"); expect(card.textContent).toContain("A team of 2 Trunks. Asked by Mira; Sapling holds it now.");
    expect(card.textContent).toContain("Abacus"); expect(card.textContent).toContain("Finding receipts"); expect(card.textContent).toContain("Not yet");
    expect(card.querySelector("button")).toBeNull();
  });
  it("says no team task is running", async () => {
    const { engine } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] } });
    await mount(engine); await click("Teams");
    expect(host.textContent).toContain("No team task is running.");
  });
});

describe("People › Activity", () => {
  const EVENTS = { events: [
    { eventType: "agent_run", eventId: "e1", agentId: "books", runId: "r1", sessionKey: "agent:books:a", status: "succeeded", occurredAt: Date.now() - 60_000 },
    { eventType: "tool_action", eventId: "e2", agentId: "books", runId: "r1", toolName: "read_pdf", status: "blocked", occurredAt: Date.now() - 120_000 },
  ], nextCursor: "c2" };
  const table = (extra: Record<string, Answer> = {}) => ({ ...BASE, "sessions.list": { sessions: [{ key: "agent:books:a", label: "Card statement" }] }, "audit.activity.list": (p: Record<string, unknown>) => p.cursor ? { events: [{ eventType: "agent_run", eventId: "e3", agentId: "main", runId: "r2", status: "failed", occurredAt: 1 }] } : EVENTS, ...extra });

  it("lists the audit log in words, pages with the cursor and filters through the engine", async () => {
    const { engine, request } = fakeEngine(table());
    await mount(engine); await click("Activity");
    expect(request).toHaveBeenCalledWith("audit.activity.list", { limit: 100 });
    expect(host.textContent).toContain("Abacus · Run · Done: Card statement"); expect(host.textContent).toContain("Tool step · Blocked: read_pdf");
    expect(host.textContent).toContain("Records are kept 30 days.");
    await click("Load more"); expect(request).toHaveBeenCalledWith("audit.activity.list", { limit: 100, cursor: "c2" });
    expect(host.textContent).toContain("Sapling · Run · Failed");
    const pick = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pp-pick")].find(x => x.textContent?.startsWith(label))!;
    expect(pick("Chat app").disabled).toBe(true);
    await act(async () => { pick("Kind").click(); });
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>(".mi")].find(x => x.textContent?.includes("Tool steps"))!.click(); });
    expect(request).toHaveBeenCalledWith("audit.activity.list", { limit: 100, kind: "tool_action" });
    expect(pick("Kind").textContent).toBe("Kind: Tool steps");
    expect(button("Clear")).toBeTruthy();
  });

  it("shows the reports off row with Set up greyed when the plugin is off", async () => {
    const { engine } = fakeEngine(table({ "audit.activity.list": { events: [] } }));
    await mount(engine); await click("Activity");
    expect(host.textContent).toContain("Off until you choose"); expect(button("Set up")!.disabled).toBe(true);
    expect(host.textContent).toContain("Nothing has happened in the team yet.");
    expect(button("Explain")).toBeUndefined();
  });

  it("explains a run from Advanced and makes today's report when reports are on", async () => {
    const { engine, request } = fakeEngine(table({
      "audit.run.inspect": { schemaVersion: 1, run: { runId: "r1", status: "known" }, identity: { state: "present" }, decisionDisplays: [{ action: { family: "tool", operation: "exec", summary: "Ran a command" }, decision: { outcome: "allowed", reasonCode: "policy" }, occurredAt: 1 }], coverage: { state: "enforced", missingEvidence: [] } },
      "team-reports.status": { running: true }, "team-reports.list": { periods: [{ period: "day", key: "2026-10-02", status: "partial", generatedAtMs: 1, activeMembers: 3 }] },
      "team-reports.get": { markdown: "# The day" }, "team-reports.generate": { runId: "run-9" },
    }));
    await mount(engine, "advanced"); await click("Activity");
    expect(request).toHaveBeenCalledWith("team-reports.get", { period: "day", key: "2026-10-02", format: "markdown" });
    expect(host.textContent).toContain("# The day");
    await click("Make today's report"); expect(request).toHaveBeenCalledWith("team-reports.generate", { period: "day" }); expect(host.textContent).toContain("run-9");
    await click("Explain"); expect(request).toHaveBeenCalledWith("audit.run.inspect", { runId: "r1" });
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Ran a command");
  });
});

describe("People › Usage", () => {
  it("draws a bar per person from the engine's month-to-date usage by creator", async () => {
    const usage = { aggregates: { byCreator: [
      { key: "a", actor: { type: "human", id: "p-mira", label: "Mira Stone" }, totals: { totalCost: 9.4, totalTokens: 100 }, sessionCount: 2, daily: [], sessionActivity: [] },
      { key: "b", actor: { type: "human", id: "gateway-owner", label: "Rowan Vale" }, totals: { totalCost: 4.7, totalTokens: 50 }, sessionCount: 1, daily: [], sessionActivity: [] },
    ] } };
    const { engine, request } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] }, "sessions.usage": usage });
    await mount(engine); await click("Usage");
    const [params] = calls(request, "sessions.usage") as Record<string, string>[];
    expect(params.agentScope).toBe("all"); expect(params.mode).toBe("gateway"); expect(params.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    const rowsText = [...host.querySelectorAll(".pp-brow")].map(r => r.textContent);
    expect(rowsText).toEqual(["Mira$9.40", "Rowan$4.70"]);
    expect((host.querySelectorAll(".pp-brow u")[1] as HTMLElement).style.width).toBe("50%");
  });
  it("shows the empty line when nobody used a model", async () => {
    const { engine } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] }, "sessions.usage": { aggregates: { byCreator: [] } } });
    await mount(engine); await click("Usage");
    expect(host.textContent).toContain("Nobody has used a model this month.");
  });
});

describe("People › Rules", () => {
  it("draws the team rules disabled under the banner with their reason", async () => {
    const { engine, request } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] } });
    await mount(engine); await click("Access"); await click("Rules");
    expect(host.textContent).toContain("Your keepoak.com team is optional");
    expect(host.textContent).toContain("Spending that needs an Admin’s yes"); expect(host.textContent).toContain("Keep team conversations");
    const controls = [...host.querySelectorAll<HTMLButtonElement>(".pp-ctl button")];
    expect(controls.length).toBe(9); expect(controls.every(c => c.disabled && c.title.includes("keepoak.com team"))).toBe(true);
    expect(button("Forever")!.getAttribute("aria-pressed")).toBe("true");
    expect(request.mock.calls.some(([m]) => String(m).startsWith("config."))).toBe(false);
  });
});

describe("People › Signing in", () => {
  const DEVICES = { pending: [{ requestId: "q1", deviceId: "d9", publicKey: "k", displayName: "Pixel 9", deviceFamily: "mobile", scopes: ["operator.read", "operator.write"], ts: 1 }],
    paired: [{ deviceId: "d1", publicKey: "k", displayName: "Work laptop", deviceFamily: "desktop", role: "operator", createdAtMs: 1, approvedAtMs: 1, lastSeenAtMs: Date.now() - 300_000, connected: false }] };
  const CONFIG = { hash: "h7", valid: true, config: { gateway: { nodes: { pairing: { autoApproveCidrs: [] } } } } };
  const table = (extra: Record<string, Answer> = {}) => ({ ...BASE, "sessions.list": { sessions: [] }, "device.pair.list": DEVICES, "device.pair.approve": { ok: true }, "device.pair.reject": { ok: true }, "device.pair.remove": { ok: true }, "device.token.rotate": { deviceId: "d1", role: "operator", scopes: [], rotatedAtMs: 1, tokenDelivery: "withheld-cross-device" }, "config.get": CONFIG, "config.patch": { ok: true }, ...extra });

  it("greys the sign-in rows the engine can't back, and approves or turns down waiting devices", async () => {
    const { engine, request } = fakeEngine(table());
    await mount(engine); await click("Access"); await click("Signing in");
    expect(button("When needed")!.disabled).toBe(true); expect(button("Passkey")!.disabled).toBe(true); expect(button("Passkey")!.title).toBe("");
    expect(host.querySelectorAll(".pp-ctl[data-off]").length).toBeGreaterThan(0); expect(visibleDevNotes(host)).toEqual([]);
    expect(host.textContent).toContain("Waiting for approval (1)"); expect(host.textContent).toContain("Wants: read, write");
    await click("Allow"); expect(request).toHaveBeenCalledWith("device.pair.approve", { requestId: "q1" });
    await click("Don’t allow");
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.textContent?.trim() === "Don’t allow")!.click(); });
    expect(request).toHaveBeenCalledWith("device.pair.reject", { requestId: "q1" });
    expect(host.textContent).toContain("Work laptop"); expect(host.textContent).not.toContain("Approve a computer I can reach over SSH");
  });

  it("removes a paired device after asking, and rotates its key at Technical without inventing a token", async () => {
    const { engine, request } = fakeEngine(table());
    await mount(engine, "technical"); await click("Access"); await click("Signing in");
    await act(async () => { (document.querySelector('[aria-label="More for Work laptop"]') as HTMLButtonElement).click(); });
    await click("Make a new key"); expect(request).toHaveBeenCalledWith("device.token.rotate", { deviceId: "d1", role: "operator" });
    expect(host.textContent).toContain("the engine gives it only to that device");
    await act(async () => { (document.querySelector('[aria-label="More for Work laptop"]') as HTMLButtonElement).click(); });
    await click("Remove…"); await click("Remove"); expect(request).toHaveBeenCalledWith("device.pair.remove", { deviceId: "d1" });
  });

  it("saves the pairing rules from Advanced with config.patch on the read revision", async () => {
    const { engine, request } = fakeEngine(table());
    await mount(engine, "advanced"); await click("Access"); await click("Signing in");
    await act(async () => { (host.querySelector('[role="switch"][aria-label="Approve a computer I can reach over SSH"]') as HTMLButtonElement).click(); });
    expect(request).toHaveBeenCalledWith("config.patch", { raw: JSON.stringify({ gateway: { nodes: { pairing: { sshVerify: false } } } }), baseHash: "h7" });
    const input = host.querySelector('input[aria-label="Its web address"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "http://example.test"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(button("Save")!.disabled).toBe(true);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://branch.home.test"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Save"); await click("Open it");
    expect(request).toHaveBeenCalledWith("config.patch", { raw: JSON.stringify({ gateway: { publicOrigin: "https://branch.home.test" } }), baseHash: "h7" });
    expect(button("Viewer")!.title).toContain("web address first");
  });
});

describe("People place", () => {
  it("switches tab on the window's branch:place-tab event for People", async () => {
    const { engine } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] } });
    await mount(engine);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "rules" } })); });
    const picked = () => [...host.querySelectorAll('[role="tab"][aria-selected="true"]')].map(t => t.textContent);
    expect(picked()).toEqual(["Team", "Live now"]);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "people", tab: "Rules" } })); });
    expect(picked()).toEqual(["Access", "Rules"]);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "people", tab: "signin" } })); });
    expect(picked()).toEqual(["Access", "Signing in"]);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "people", tab: "people" } })); });
    expect(picked()).toEqual(["Team", "People2"]);
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "people", tab: "usage" } })); });
    expect(picked()).toEqual(["Usage"]);
  });
});

describe("People final round", () => {
  it("lists people who aren't connected under On this computer, with no invented heading", async () => {
    const { engine } = fakeEngine({ ...BASE, "system-presence": [], "sessions.list": { sessions: [] } });
    await mount(engine); await click("People2");
    expect([...host.querySelectorAll(".pp-grp")].map(g => g.textContent)).toEqual(["On this computer"]);
    expect(host.textContent).not.toContain("Not online now");
  });
  it("shows a Shared owner chip for connections made with the Gateway's key", async () => {
    const { engine } = fakeEngine({ ...BASE, "system-presence": [{ host: "laptop", mode: "webchat", roles: ["operator"], ts: 1 }, { host: "gw", mode: "gateway", ts: 1 }], "sessions.list": { sessions: [] } });
    await mount(engine);
    const chip = host.querySelector(".pp-keyed") as HTMLElement;
    expect(chip.textContent).toContain("Shared owner"); expect(chip.textContent).toContain("1 connection"); expect(chip.title).toContain("not a personal sign-in");
  });
  it("draws each model account's limits under the Usage bars from usage.status", async () => {
    const { engine, request } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] }, "sessions.usage": { aggregates: { byCreator: [] } },
      "usage.status": { updatedAt: 1, providers: [{ provider: "openai", displayName: "ChatGPT", plan: "Plus", windows: [{ label: "5 hours", usedPercent: 88 }, { label: "Week", usedPercent: 40 }] }, { provider: "x", displayName: "Other", windows: [] }] } });
    await mount(engine); await click("Usage");
    expect(request).toHaveBeenCalledWith("usage.status", {});
    const lims = host.querySelector(".pp-lims")!;
    expect(lims.textContent).toContain("ChatGPT"); expect(lims.textContent).toContain("12% left"); expect(lims.textContent).toContain("60% left");
    expect(lims.querySelector("i.low")).toBeTruthy(); expect(lims.textContent).toContain("This service does not say what it allows.");
  });
});

describe("People tabs (DA-50)", () => {
  const top = () => [...host.querySelectorAll('[role="tablist"][aria-label="People"] [role="tab"]')].map(t => t.textContent);
  it("shows four top tabs, so none runs past the content column", async () => {
    const { engine } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] } });
    await mount(engine);
    expect(top()).toEqual(["Team", "Activity", "Access", "Usage"]);
  });
  it("keeps every old view one click under Team or Access", async () => {
    const { engine } = fakeEngine({ ...BASE, "sessions.list": { sessions: [] }, "config.get": { hash: "h", config: {} }, "device.pair.list": { pending: [], paired: [] } });
    await mount(engine);
    const views = (label: string) => [...host.querySelectorAll(`[role="tablist"][aria-label="${label}"] [role="tab"]`)].map(t => t.textContent);
    expect(views("Team")).toEqual(["Live now", "People2", "Teams"]);
    await click("Access");
    expect(views("Access")).toEqual(["Signing in", "Shared", "Access groups", "Rules"]);
    expect(views("Team")).toEqual([]);
    expect(host.textContent).not.toContain("Your keepoak.com team is optional");
    await click("Rules"); expect(host.textContent).toContain("Your keepoak.com team is optional");
  });
});
