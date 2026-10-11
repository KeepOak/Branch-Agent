// Mark all read must show everywhere a thread is listed: the Conversations list and the Inbox
// (both read sessions.list rows) and the contact roster (contacts.list).
import { describe, expect, it } from "vitest";
import { applyReadMutation, READ_MUTATION_RETENTION_MS } from "../contacts/read-state.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { contactHandlers } from "./contacts.js";
import {
  identifiedClient,
  listSessions,
  requestContext,
  seedSessions,
} from "./sessions-read-cache.test-support.js";
import { replaceSessionEntry, loadSessionEntry } from "../../config/sessions/session-accessor.js";
import type { RespondFn } from "./types.js";

const ACTIVE = { agentId: "main", sessionKey: "agent:main:active" };

/** Gives the active thread activity after its last read, so it is unread before Mark all read. */
async function makeActiveThreadUnread(): Promise<void> {
  const entry = loadSessionEntry(ACTIVE);
  await replaceSessionEntry(ACTIVE, { ...entry!, lastActivityAt: 500, lastReadAt: 100 });
}

async function callContacts(method: string, params: Record<string, unknown>, context: unknown) {
  let reply: { ok: boolean; payload?: any; error?: { message?: string } } | undefined;
  await contactHandlers[method]!({
    params,
    client: null,
    context,
    respond: ((ok: boolean, payload?: unknown, error?: { message?: string }) => {
      reply = { ok, payload, error };
    }) as RespondFn,
  } as never);
  return reply!;
}

describe("Mark all read shows in every view", () => {
  it("clears the thread in sessions.list rows and in the contact roster", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const config = await seedSessions();
      const context = { ...requestContext(config), broadcast: () => undefined } as ReturnType<typeof requestContext>;
      const client = identifiedClient("owner@example.com");
      await makeActiveThreadUnread();

      const before = await listSessions({ client, context, request: {} });
      expect(before.sessions.find((row) => row.key === ACTIVE.sessionKey)).toMatchObject({ unread: true });

      const marked = await callContacts("contacts.markAllRead", { mutationId: "views-1" }, context);
      expect(marked.ok).toBe(true);

      const after = await listSessions({ client, context, request: {} });
      expect(after.sessions.find((row) => row.key === ACTIVE.sessionKey)).toMatchObject({ unread: false });

      const roster = await callContacts("contacts.list", {}, context);
      const unread = roster.payload.contacts.filter(
        (contact: { threadUnread: boolean; unreadTopics: number }) => contact.threadUnread || contact.unreadTopics > 0,
      );
      expect(unread).toEqual([]);
    });
  });

  it("refuses a reused mutation id for different sessions, and answers a same-scope retry without writing", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const config = await seedSessions();
      const context = { ...requestContext(config), broadcast: () => undefined } as ReturnType<typeof requestContext>;
      const first = await callContacts("contacts.markAllRead", { mutationId: "reuse-1", sessionKeys: [ACTIVE.sessionKey] }, context);
      expect(first.payload.applied).toBe(true);

      const retry = await callContacts("contacts.markAllRead", { mutationId: "reuse-1", sessionKeys: [ACTIVE.sessionKey] }, context);
      expect(retry.payload).toMatchObject({ applied: false, readThroughMs: first.payload.readThroughMs });

      const conflict = await callContacts("contacts.markAllRead", { mutationId: "reuse-1" }, context);
      expect(conflict.ok).toBe(false);
      expect(conflict.error?.message).toContain("already used for different sessions");
    });
  });

  it("forgets mutation ids after the seven-day retention window", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const t0 = 1_800_000_000_000;
      expect(applyReadMutation({ mutationId: "retain-1", scopes: ["*"], nowMs: t0 }).applied).toBe(true);
      expect(applyReadMutation({ mutationId: "retain-1", scopes: ["*"], nowMs: t0 + 1_000 }).applied).toBe(false);
      expect(
        applyReadMutation({ mutationId: "retain-1", scopes: ["*"], nowMs: t0 + READ_MUTATION_RETENTION_MS + 1 }).applied,
      ).toBe(true);
    });
  });
});

