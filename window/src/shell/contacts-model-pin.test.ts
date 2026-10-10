import type { Contact as GatewayContact } from "@branch/gateway-protocol";
import { expect, it, vi } from "vitest";
import { projectConversation, type Conversation } from "../connect/conversations";
import type { Actions } from "./conversation-actions";
import { pinContact, projectContact } from "./contacts-model";

const raw = (id: string, extra: Partial<GatewayContact> = {}): GatewayContact => ({
  id: `trunk:${id}`, kind: "trunk", name: id, threadKey: `agent:${id}:main`, isDefault: id === "oak",
  lastActivityAt: 10, preview: { kind: "message", text: "Main reply", at: 10 },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});

type Request = (method: string, params?: unknown) => Promise<unknown>;

function actionsFor(request: Request): Actions {
  return {
    pin: async (row: Conversation) => {
      await request("sessions.patch", {
        key: row.key,
        ...(row.agentId ? { agentId: row.agentId } : {}),
        ...(row.sessionId ? { expectedSessionId: row.sessionId } : {}),
        pinned: true,
        snoozedUntil: null,
      });
    },
  } as Actions;
}

it("adopts a Trunk with no conversation before pinning it", async () => {
  const [contact] = projectContact([raw("oak")], []);
  const request = vi.fn<Request>(async (method) => method === "sessions.create" ? { key: "agent:oak:main", sessionId: "sess-oak" } : {});
  const refreshContacts = vi.fn();
  await pinContact(contact, [], actionsFor(request), request, refreshContacts);
  expect(request.mock.calls.map(([method, params]) => [method, params])).toEqual([
    ["sessions.create", { key: "agent:oak:main", agentId: "oak" }],
    ["sessions.patch", { key: "agent:oak:main", agentId: "oak", expectedSessionId: "sess-oak", pinned: true, snoozedUntil: null }],
  ]);
  expect(refreshContacts).toHaveBeenCalledTimes(1);
});

it("pins a Trunk that already has its conversation without creating one", async () => {
  const sessions = [projectConversation({ key: "agent:oak:main", agentId: "oak", updatedAt: 10 }, null)];
  const [contact] = projectContact([raw("oak")], sessions);
  const request = vi.fn<Request>(async () => ({}));
  const refreshContacts = vi.fn();
  await pinContact(contact, sessions, actionsFor(request), request, refreshContacts);
  expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
  expect(request).toHaveBeenCalledExactlyOnceWith("sessions.patch", { key: "agent:oak:main", agentId: "oak", pinned: true, snoozedUntil: null });
  expect(refreshContacts).toHaveBeenCalledTimes(1);
});
