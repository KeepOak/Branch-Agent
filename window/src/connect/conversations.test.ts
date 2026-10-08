import { describe, expect, it, vi } from "vitest";
import { ConversationList, projectConversation } from "./conversations";
import { conversationActions } from "../shell/conversation-actions";

function requestFixture(impl: (method: string, params?: unknown) => Promise<unknown>) {
  const request = vi.fn(impl);
  return request as typeof request & Parameters<typeof conversationActions>[0];
}

const CONTACT = { key: "agent:fern:home", sessionId: "existing-session", execCwd: "/owned/project", model: "p/kept", hasActiveRun: true };

describe("exact selected contacts", () => {
  it("uses the keyed read while another page read is pending, without mutating the existing contact", async () => {
    let finish!: (value: unknown) => void;
    const request = requestFixture((method: string) => method === "sessions.list"
      ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(method === "agents.list"
        ? { defaultId: "fern", mainKey: "home" } : { session: CONTACT }));
    const list = new ConversationList(request, null), pending = list.refresh();
    const actions = conversationActions(request, list, () => null);
    expect(await actions.create()).toBe(CONTACT.key);
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
    finish({ sessions: [] }); await pending;
    expect(list.getSnapshot().rows.find((row) => row.key === CONTACT.key)).toMatchObject({ sessionId: "existing-session", folder: "/owned/project", working: true });
  });

  it("retains an exact described contact outside the 200-row sidebar page through subsequent refreshes", async () => {
    const page = Array.from({ length: 200 }, (_, i) => ({ key: `agent:fern:item-${i}`, sessionId: `s${i}` }));
    const request = requestFixture((method: string) => Promise.resolve(method === "sessions.list" ? { sessions: page }
      : method === "agents.list" ? { defaultId: "fern", mainKey: "home" } : { session: CONTACT }));
    const list = new ConversationList(request, null);
    await list.refresh();
    expect(await conversationActions(request, list, () => null).create()).toBe(CONTACT.key);
    await list.refresh();
    expect(list.getSnapshot().rows).toHaveLength(201);
    expect(list.getSnapshot().rows.find((row) => row.key === CONTACT.key)?.sessionId).toBe(CONTACT.sessionId);
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
    expect(request.mock.calls.filter(([method]) => method === "sessions.list").every(([, params]) => (params as { limit: number }).limit === 200)).toBe(true);
  });

  it("awaits both the in-flight page and its coalesced trailing refresh", async () => {
    const completions: Array<(value: unknown) => void> = [];
    const request = requestFixture(() => new Promise((resolve) => { completions.push(resolve); }));
    const list = new ConversationList(request, null);
    let firstDone = false, secondDone = false;
    const first = list.refresh().then(() => { firstDone = true; });
    await Promise.resolve();
    const second = list.refresh().then(() => { secondDone = true; });
    completions[0]({ sessions: [] });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(firstDone).toBe(false); expect(secondDone).toBe(false);
    expect(completions).toHaveLength(2);
    completions[1]({ sessions: [CONTACT] });
    await Promise.all([first, second]);
    expect(firstDone).toBe(true); expect(secondDone).toBe(true);
    expect(list.getSnapshot().rows[0].sessionId).toBe(CONTACT.sessionId);
  });

  it("removes the retained projection when a subsequent exact read reports the contact missing", async () => {
    let exists = true;
    const request = requestFixture((method: string) => Promise.resolve(method === "sessions.list"
      ? { sessions: [] } : { session: exists ? CONTACT : null }));
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern"); exists = false;
    await list.refresh();
    expect(list.getSnapshot().rows.some((row) => row.key === CONTACT.key)).toBe(false);
  });

  it("restores a saved contact outside the initial page before marking the list loaded", async () => {
    const page = Array.from({ length: 200 }, (_, i) => ({ key: `agent:fern:item-${i}`, sessionId: `s${i}` }));
    const request = requestFixture((method: string) => Promise.resolve(method === "sessions.subscribe"
      ? { list: { sessions: page } } : { session: CONTACT }));
    const list = new ConversationList(request, "agent:fern:default", CONTACT.key);
    const loadedSnapshots: string[][] = [];
    list.subscribe(() => { if (list.getSnapshot().loaded) loadedSnapshots.push(list.getSnapshot().rows.map((row) => row.key)); });
    await list.start();
    expect(loadedSnapshots.length).toBeGreaterThan(0);
    expect(loadedSnapshots.every((keys) => keys.includes(CONTACT.key))).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.describe", expect.objectContaining({ key: CONTACT.key, agentId: "fern" }));
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });

  it("leaves a deleted saved thread absent so the shell's normal fallback still applies", async () => {
    const key = "agent:fern:deleted-thread";
    const request = requestFixture((method: string) => Promise.resolve(method === "sessions.subscribe"
      ? { list: { sessions: [{ key: "agent:fern:default", sessionId: "default-session" }] } } : { session: null }));
    const list = new ConversationList(request, "agent:fern:default", key);
    await list.start();
    expect(list.getSnapshot().loaded).toBe(true);
    expect(list.getSnapshot().rows.some((row) => row.key === key)).toBe(false);
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });

  it("does not retain or recreate a saved private contact when the keyed read is denied", async () => {
    const key = "agent:fern:incognito:private-session";
    const request = requestFixture((method: string) => method === "sessions.subscribe"
      ? Promise.resolve({ list: { sessions: [] } }) : Promise.reject(new Error("Contact access denied")));
    const list = new ConversationList(request, null, key);
    await list.start();
    expect(list.getSnapshot()).toMatchObject({ loaded: false, rows: [], error: "Contact access denied" });
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });

  it("hides a previously retained private row when a subsequent exact read is denied", async () => {
    let denied = false;
    const request = requestFixture((method: string) => method === "sessions.list" ? Promise.resolve({ sessions: [] })
      : denied ? Promise.reject(new Error("Contact access denied")) : Promise.resolve({ session: CONTACT }));
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern"); denied = true;
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: false, rows: [], error: "Contact access denied" });
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });

  it("keeps a failed read retryable without treating a network failure as deletion", async () => {
    let disconnected = false;
    const request = requestFixture((method: string) => method === "sessions.list" ? Promise.resolve({ sessions: [] })
      : disconnected ? Promise.reject(new Error("Network unavailable")) : Promise.resolve({ session: CONTACT }));
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern"); disconnected = true;
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: false, rows: [], error: "Network unavailable" });
    disconnected = false;
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ loaded: true, error: null });
    expect(list.getSnapshot().rows.find((row) => row.key === CONTACT.key)?.sessionId).toBe(CONTACT.sessionId);
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });

  it("hides a retained private row when a direct reopening read is denied without recreating it", async () => {
    let denied = false;
    const request = requestFixture((method: string) => method === "agents.list"
      ? Promise.resolve({ defaultId: "fern", mainKey: "home" }) : denied
        ? Promise.reject(new Error("Contact access denied")) : Promise.resolve({ session: CONTACT }));
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern"); denied = true;
    expect(await conversationActions(request, list, () => CONTACT.key).create()).toBeNull();
    expect(list.getSnapshot()).toMatchObject({ rows: [], loaded: false });
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });

  it("hides a retained row when its direct keyed read returns a different identity", async () => {
    let wrong = false;
    const request = requestFixture(() => Promise.resolve({ session: wrong ? { ...CONTACT, key: "agent:fern:other" } : CONTACT }));
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern"); wrong = true;
    await expect(list.selectContact(CONTACT.key, "fern")).rejects.toThrow("different or incomplete");
    expect(list.getSnapshot()).toMatchObject({ rows: [], loaded: false });
  });

  it("removes an old retained projection when a direct exact read confirms it is missing", async () => {
    let exists = true;
    const request = requestFixture(() => Promise.resolve({ session: exists ? CONTACT : null }));
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern"); exists = false;
    expect(await list.selectContact(CONTACT.key, "fern")).toBeNull();
    expect(list.getSnapshot().rows.some((row) => row.key === CONTACT.key)).toBe(false);
    expect(list.getSnapshot()).toMatchObject({ loaded: true, error: null });
  });

  it("removes a denied previously cached contact while preserving another selected authorized contact", async () => {
    const other = { key: "agent:oak:home", sessionId: "other-session" };
    let denied = false;
    const request = requestFixture((_method: string, params?: unknown) => {
      const key = (params as { key: string }).key;
      if (denied && key === CONTACT.key) return Promise.reject(new Error("Contact access denied"));
      return Promise.resolve({ session: key === CONTACT.key ? CONTACT : other });
    });
    const list = new ConversationList(request, null);
    await list.selectContact(CONTACT.key, "fern");
    await list.selectContact(other.key, "oak"); denied = true;
    await expect(list.selectContact(CONTACT.key, "fern")).rejects.toThrow("Contact access denied");
    expect(list.getSnapshot().rows.some((row) => row.key === CONTACT.key)).toBe(false);
    expect(list.getSnapshot().rows.find((row) => row.key === other.key)?.sessionId).toBe(other.sessionId);
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  });
});

describe("projectConversation", () => {
  it("reads a sessions.list row", () => {
    const row = projectConversation(
      {
        key: "agent:dev:dashboard:1",
        label: "Garden plan",
        displayName: "Ignored",
        agentId: "dev",
        pinned: true,
        archived: false,
        unread: true,
        snoozedUntil: 5000,
        createdAt: 10,
        updatedAt: 20,
        lastMessagePreview: "hello\n  there",
        hasActiveRun: false,
        activeRunIds: ["r1"],
        totalTokens: 100,
        contextTokens: 400,
      },
      "agent:dev:main",
    );
    expect(row).toMatchObject({
      key: "agent:dev:dashboard:1",
      title: "Garden plan",
      agentId: "dev",
      isMain: false,
      pinned: true,
      unread: true,
      snoozedUntil: 5000,
      preview: "hello there",
      working: true,
      totalTokens: 100,
      contextTokens: 400,
    });
  });

  it("falls back to displayName, then derivedTitle, and marks the main conversation", () => {
    expect(projectConversation({ key: "agent:dev:main", derivedTitle: "First words" }, "agent:dev:main")).toMatchObject({
      title: "First words",
      isMain: true,
      agentId: "dev",
      createdAt: 0,
    });
    expect(projectConversation({ key: "k", displayName: "Shown" }, null).title).toBe("Shown");
  });

  it("tolerates junk", () => {
    expect(projectConversation(null, null)).toMatchObject({ key: "", title: "", pinned: false, snoozedUntil: null });
  });

  it("marks a session waiting-on-user or in provider review as needsYou", () => {
    expect(projectConversation({ key: "k", observerDigest: { health: "waiting-on-user", headline: "Needs a yes" } }, null).needsYou).toBe(true);
    expect(projectConversation({ key: "k", providerReview: { status: "pending" } }, null).needsYou).toBe(true);
    expect(projectConversation({ key: "k", needsYou: true }, null).needsYou).toBe(true);
    expect(projectConversation({ key: "k", observerDigest: { health: "on-track" } }, null).needsYou).toBeUndefined();
  });
});
