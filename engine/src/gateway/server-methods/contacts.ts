import { listA2aPeers, refreshA2aPeerCards } from "../../../extensions/a2a/src/card-cache.js";
import {
  ErrorCodes,
  errorShape,
  validateContactsListParams,
  validateContactsTopicsParams,
  validateContactsMarkReadParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { listAgentEntries } from "../../agents/agent-scope.js";
import { resolveExistingAgentSessionStoreTargetsSync } from "../../config/sessions.js";
import {
  listSessionEntriesReadOnly,
  patchSessionEntryCore,
  type SessionEntrySummary,
} from "../../config/sessions/session-accessor.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { listExistingAgentIdsFromDisk, listGatewayAgentsBasic } from "../agent-list.js";
import { projectContacts } from "../contacts/project.js";
import { hasOperatorBoundary, resolveOperatorRolePolicy } from "../operator-role-policy.js";
import { createSessionListEntryFilter } from "../session-sharing.js";
import { readSessionTitleFieldsFromTranscriptAsync } from "../session-transcript-title-reader.js";
import { deriveSessionTitle } from "../session-utils-core.js";
import { emitSessionsChanged } from "./session-change-event.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { assertValidParams } from "./validation.js";

async function readProjection({
  context,
  client,
  sessionMutationAuthorization,
}: GatewayRequestHandlerOptions) {
  const cfg = context.getRuntimeConfig();
  const roster = await listGatewayAgentsBasic(cfg);
  const agentPolicy = resolveOperatorRolePolicy(client, cfg)?.agents;
  const allowedAgents = agentPolicy && agentPolicy !== "*" ? new Set(agentPolicy) : undefined;
  const sessions = new Map<string, SessionEntrySummary>();
  // Explicit rosters omit retired agents, but their existing stores remain contacts.
  const agentIds = new Set([
    ...roster.agents.map((agent) => agent.id),
    ...(await listExistingAgentIdsFromDisk()),
  ]);
  for (const agentId of agentIds) {
    if (allowedAgents && !allowedAgents.has(agentId)) continue;
    for (const target of resolveExistingAgentSessionStoreTargetsSync(cfg, agentId)) {
      for (const row of listSessionEntriesReadOnly({
        agentId: target.agentId,
        storePath: target.storePath,
        projection: "list",
      })) {
        const owner = parseAgentSessionKey(row.sessionKey)?.agentId;
        if (owner && owner !== agentId) continue;
        sessions.set(row.sessionKey, row);
      }
    }
  }
  const filter = hasOperatorBoundary(client, cfg)
    ? createSessionListEntryFilter({ client, cfg })
    : undefined;
  const visible = [...sessions.values()].filter(
    (row) => filter?.(row.sessionKey, row.entry) !== false,
  );
  const configured = new Map(listAgentEntries(cfg).map((entry) => [entry.id, entry]));
  const agents = roster.agents
    .filter((agent) => agent.kind !== "system" && (!allowedAgents || allowedAgents.has(agent.id)))
    .map((agent) => ({
      id: agent.id,
      name: configured.get(agent.id)?.identity?.name?.trim() || agent.name || agent.id,
    }));
  const previews = new Map<string, string>();
  const titles = new Map<string, string>();
  // Transcript previews are bound to the current generation. A failed/cold read
  // leaves the preview empty instead of borrowing text from a different thread.
  for (const row of visible) {
    try {
      const fields = await readSessionTitleFieldsFromTranscriptAsync({
        agentId: parseAgentSessionKey(row.sessionKey)?.agentId ?? roster.defaultId,
        sessionId: row.entry.sessionId,
        sessionKey: row.sessionKey,
        sessionEntry: row.entry,
      });
      previews.set(row.sessionKey, fields.lastMessagePreview ?? "");
      const title = deriveSessionTitle(row.entry, fields.firstUserMessage);
      if (title) titles.set(row.sessionKey, title);
    } catch {
      previews.set(row.sessionKey, "");
    }
  }
  sessionMutationAuthorization?.assertCurrent();
  return {
    ...projectContacts({
      agents,
      defaultAgentId: roster.defaultId,
      mainKey: roster.mainKey,
      sessionScope: roster.scope,
      includeDefault: !allowedAgents || allowedAgents.has(roster.defaultId),
      sessions: visible,
      previews,
      titles,
      outsidePeers: listA2aPeers(cfg),
    }),
    sessionKeys: new Set(visible.map((row) => row.sessionKey)),
  };
}

export const contactHandlers: GatewayRequestHandlers = {
  "a2a.peers.list": async ({ context, respond }) => {
    respond(true, { peers: listA2aPeers(context.getRuntimeConfig()) });
  },
  "a2a.peers.refresh": async ({ context, respond }) => {
    respond(true, { peers: await refreshA2aPeerCards(context.getRuntimeConfig()) });
  },
  "contacts.list": async (options) => {
    const { params, respond } = options;
    if (!assertValidParams(params, validateContactsListParams, "contacts.list", respond)) return;
    const { contacts, defaultId } = await readProjection(options);
    respond(true, {
      contacts: params.includeArchived ? contacts : contacts.filter((row) => !row.archivedAt),
      defaultId,
    });
  },
  "contacts.topics": async (options) => {
    const { params, respond } = options;
    if (!assertValidParams(params, validateContactsTopicsParams, "contacts.topics", respond))
      return;
    const projection = await readProjection(options);
    if (!projection.contacts.some((contact) => contact.id === params.contactId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Unknown contact"));
      return;
    }
    const rows = projection.topics.filter(
      (topic) =>
        topic.contactId === params.contactId && (!params.status || topic.status === params.status),
    );
    const isOutsideDm = (key: string) => /:[^:]+:direct:[^:]+$/.test(key);
    const ordered = rows.toSorted(
      (a, b) =>
        Number(isOutsideDm(b.key)) - Number(isOutsideDm(a.key)) ||
        (b.anchor?.at ?? 0) - (a.anchor?.at ?? 0) ||
        a.key.localeCompare(b.key),
    );
    const offset = params.cursor
      ? ordered.findIndex((topic) => topic.key === params.cursor) + 1
      : 0;
    if (params.cursor && offset === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Unknown topic cursor"));
      return;
    }
    const page = ordered.slice(offset, offset + (params.limit ?? 50));
    respond(true, {
      topics: page,
      ...(offset + page.length < ordered.length ? { nextCursor: page.at(-1)?.key } : {}),
    });
  },
  "contacts.markRead": async (options) => {
    const { params, respond, context, sessionMutationAuthorization } = options;
    if (!assertValidParams(params, validateContactsMarkReadParams, "contacts.markRead", respond))
      return;
    const projection = await readProjection(options);
    const contact = projection.contacts.find((row) => row.id === params.contactId);
    if (!contact) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Unknown contact"));
      return;
    }
    const stamp = Date.now();
    const keys = [
      contact.threadKey,
      ...projection.topics
        .filter((topic) => topic.contactId === contact.id)
        .map((topic) => topic.key),
    ].filter((key) => projection.sessionKeys.has(key));
    let updated = 0;
    for (const sessionKey of keys) {
      sessionMutationAuthorization?.assertCurrent();
      let stamped = false;
      const entry = await patchSessionEntryCore(
        { sessionKey, agentId: parseAgentSessionKey(sessionKey)?.agentId },
        (current) => {
          if (!current || (current.lastActivityAt ?? current.updatedAt) > stamp) return {};
          stamped = true;
          return {
            lastReadAt: Math.max(current.lastReadAt ?? 0, stamp),
            markedUnreadAt: undefined,
          };
        },
      );
      if (entry && stamped) {
        updated++;
        emitSessionsChanged(context, { sessionKey, reason: "read" });
      }
    }
    respond(true, { updated });
  },
};
