import { describe, expect, it, vi } from "vitest";
import { ConversationList } from "../connect/conversations";
import { conversationActions, snoozeChoices, wakeWords } from "./conversation-actions";

function fakeRequest(impl: (method: string, params?: unknown) => Promise<unknown>) {
  const request = vi.fn(impl);
  return request as typeof request & Parameters<typeof conversationActions>[0];
}

describe("contact navigation", () => {
  it("adopts and reopens the configured canonical contact without creating duplicate random threads", async () => {
    const contacts = new Map<string, { key: string; sessionId: string }>();
    const request = fakeRequest((method: string, params?: unknown) => {
      if (method === "agents.list") return Promise.resolve({ defaultId: "fern", mainKey: "home" });
      if (method === "sessions.describe") return Promise.resolve({ session: contacts.get((params as { key: string }).key) ?? null });
      if (method === "sessions.create") {
        const { key } = params as { key: string };
        if (!contacts.has(key)) contacts.set(key, { key, sessionId: `session-${key}` });
        return Promise.resolve(contacts.get(key));
      }
      return Promise.resolve({ sessions: [...contacts.values()] });
    });
    const actions = conversationActions(request, new ConversationList(request, null), () => null);
    expect(await actions.create()).toBe("agent:fern:home");
    expect(await actions.create()).toBe("agent:fern:home");
    expect(await actions.create("oak")).toBe("agent:oak:home");
    expect([...contacts.keys()]).toEqual(["agent:fern:home", "agent:oak:home"]);
    expect(request.mock.calls.filter(([method]) => method === "sessions.create").map(([, params]) => params)).toEqual([
      { key: "agent:fern:home", agentId: "fern" }, { key: "agent:oak:home", agentId: "oak" },
    ]);
    expect(request.mock.calls.filter(([method]) => method === "sessions.list")).toHaveLength(2);
  });

  it("does not open an agent before the gateway roster has adopted it", async () => {
    const request = fakeRequest((method: string) => method === "agents.list"
      ? Promise.resolve({ defaultId: "fern", mainKey: "home", agents: [{ id: "fern" }] })
      : method === "sessions.describe" ? Promise.resolve({ session: null })
      : Promise.reject(new Error('Unknown agent id "new-trunk"')));
    const actions = conversationActions(request, new ConversationList(request, null), () => null);
    expect(await actions.create("new-trunk")).toBeNull();
    expect(request.mock.calls.map(([method]) => method)).toEqual(["agents.list", "sessions.describe", "sessions.create"]);
  });

  it("does not navigate to a different key returned by the engine", async () => {
    const request = fakeRequest((method: string) => Promise.resolve(method === "agents.list"
      ? { defaultId: "fern", mainKey: "home" } : method === "sessions.describe" ? { session: null } : { key: "agent:fern:random" }));
    const actions = conversationActions(request, new ConversationList(request, null), () => null);
    expect(await actions.create()).toBeNull();
    expect(request.mock.calls.filter(([method]) => method === "sessions.list")).toHaveLength(0);
  });

  it("does not hand over a contact missing from the exact read and retries the same saved key", async () => {
    let visible = false;
    const request = fakeRequest((method: string) => Promise.resolve(method === "agents.list"
      ? { defaultId: "fern", mainKey: "home" } : method === "sessions.describe"
        ? { session: visible ? { key: "agent:fern:home", sessionId: "saved-contact" } : null } : method === "sessions.create"
        ? { key: "agent:fern:home" } : { sessions: visible ? [{ key: "agent:fern:home" }] : [] }));
    const actions = conversationActions(request, new ConversationList(request, null), () => null);
    expect(await actions.create()).toBeNull(); visible = true;
    expect(await actions.create()).toBe("agent:fern:home");
    expect(request.mock.calls.filter(([method]) => method === "sessions.create").map(([, params]) => params)).toEqual([
      { key: "agent:fern:home", agentId: "fern" },
    ]);
  });

  it("reopens an existing active contact without resubmitting creation or clearing its binding", async () => {
    const contact = { key: "agent:fern:home", sessionId: "live-session", execCwd: "/owned/project", model: "p/live", status: "running" };
    const request = fakeRequest((method: string) => Promise.resolve(method === "agents.list"
      ? { defaultId: "fern", mainKey: "home" } : { session: contact }));
    const actions = conversationActions(request, new ConversationList(request, null), () => contact.key);
    expect(await actions.create()).toBe(contact.key);
    expect(await actions.create("fern")).toBe(contact.key);
    expect(request.mock.calls.every(([method]) => method === "agents.list" || method === "sessions.describe")).toBe(true);
    expect(contact).toEqual({ key: "agent:fern:home", sessionId: "live-session", execCwd: "/owned/project", model: "p/live", status: "running" });
  });

  it("does not adopt or mutate a contact when its authoritative keyed read fails", async () => {
    const request = fakeRequest((method: string) => method === "agents.list"
      ? Promise.resolve({ defaultId: "fern", mainKey: "home" }) : Promise.reject(new Error("List unavailable")));
    const actions = conversationActions(request, new ConversationList(request, null), () => null);
    expect(await actions.create()).toBeNull();
    expect(request.mock.calls.map(([method]) => method)).toEqual(["agents.list", "sessions.describe"]);
  });
});

describe("snoozeChoices", () => {
  it("offers This evening only when 18:00 is more than an hour away", () => {
    const morning = new Date(2026, 9, 1, 9, 0).getTime(); // a Thursday
    expect(snoozeChoices(morning).map((c) => c.label)).toEqual(["In 1 hour", "In 3 hours", "This evening", "Tomorrow", "Next week"]);
    const late = new Date(2026, 9, 1, 17, 30).getTime();
    expect(snoozeChoices(late).map((c) => c.label)).not.toContain("This evening");
  });
  it("leaves out Next week on a Sunday and puts it on Monday 09:00", () => {
    const sunday = new Date(2026, 9, 4, 10, 0).getTime();
    expect(snoozeChoices(sunday).map((c) => c.label)).not.toContain("Next week");
    const thursday = new Date(2026, 9, 1, 10, 0).getTime();
    const next = snoozeChoices(thursday).find((c) => c.label === "Next week");
    const d = new Date(next?.until ?? 0);
    expect([d.getDay(), d.getHours(), d.getDate()]).toEqual([1, 9, 5]);
  });
  it("Tomorrow is 09:00 the next day", () => {
    const t = snoozeChoices(new Date(2026, 9, 1, 22, 0).getTime()).find((c) => c.label === "Tomorrow");
    const d = new Date(t?.until ?? 0);
    expect([d.getDate(), d.getHours()]).toEqual([2, 9]);
  });
});

describe("wakeWords", () => {
  const now = new Date(2026, 9, 1, 9, 0).getTime();
  it("today, tomorrow, then a weekday", () => {
    expect(wakeWords(new Date(2026, 9, 1, 18, 0).getTime(), now)).toBe("18:00");
    expect(wakeWords(new Date(2026, 9, 2, 9, 0).getTime(), now)).toBe("tomorrow 09:00");
    expect(wakeWords(new Date(2026, 9, 5, 9, 0).getTime(), now)).toMatch(/09:00$/);
  });
});
