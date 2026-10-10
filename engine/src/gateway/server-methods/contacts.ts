import { randomUUID } from "node:crypto";
import { listA2aPeers, refreshA2aPeerCards } from "../../../extensions/a2a/src/card-cache.js";
import {
  ErrorCodes,
  errorShape,
  validateContactsListParams,
  validateContactsTopicsParams,
  validateContactsMarkAllReadParams,
  validateContactsMarkReadParams,
  validateContactsOutsideHelloParams,
  validateContactsOutsideListParams,
  validateContactsOutsideSetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { listAgentEntries } from "../../agents/agent-scope.js";
import { resolveExistingAgentSessionStoreTargetsSync } from "../../config/sessions.js";
import {
  listSessionEntriesReadOnly,
  type SessionEntrySummary,
} from "../../config/sessions/session-accessor.js";
import { readAgentDatabaseAdmissionRefusal } from "../../state/agent-database-admission.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { listExistingAgentIdsFromDisk, listGatewayAgentsBasic } from "../agent-list.js";
import {
  assignOutsideAgentId,
  graftDeviceId,
  outsideAgentDeviceRefusal,
  outsideAgentDeviceRows,
  reclaimDeviceRow,
  isOutsideAgentOnline,
  listOutsideAgents,
  outsideAgentPeers,
  outsideAgentMayMessage,
  outsideAgentMayDriveWindow,
  outsideAgentRefusal,
  readOutsideAgentSettings,
  recordOutsideAgent,
  updateOutsideAgentSettings,
} from "../contacts/outside-agents.js";
import { projectContacts } from "../contacts/project.js";
import {
  ALL_THREADS_SCOPE,
  applyReadMutation,
  readReadMarkers,
  withReadMarkers,
} from "../contacts/read-state.js";
import { claimGraftWork, completeGraftWork, enqueueGraftWork, getGraftWork } from "../contacts/graft-work.js";
import { hasOperatorBoundary, resolveOperatorRolePolicy } from "../operator-role-policy.js";
import { removeOutsideRoomMembers } from "../rooms/store.js";
import { createSessionListEntryFilter } from "../session-sharing.js";
import { readSessionTitleFieldsFromTranscriptAsync } from "../session-transcript-title-reader.js";
import { deriveSessionTitle } from "../session-utils-core.js";
import { deviceHandlers } from "./devices.js";
import { createVisibleActiveSessionRunProjector } from "./session-active-runs.js";
import { emitSessionsChanged } from "./session-change-event.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { assertValidParams } from "./validation.js";

/** One plain line for the owner; the refusal's repair text stays in logs. */
function startingUpMessage(agentIds: readonly string[]): string {
  const names = agentIds.map((id) => id.charAt(0).toUpperCase() + id.slice(1));
  return `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} still starting up.`;
}

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
  const markers = readReadMarkers();
  const unavailableAgentIds: string[] = [];
  // Explicit rosters omit retired agents, but their existing stores remain contacts.
  const agentIds = new Set([
    ...roster.agents.map((agent) => agent.id),
    ...(await listExistingAgentIdsFromDisk()),
  ]);
  for (const agentId of agentIds) {
    if (allowedAgents && !allowedAgents.has(agentId)) continue;
    try {
      for (const target of resolveExistingAgentSessionStoreTargetsSync(cfg, agentId)) {
        for (const row of listSessionEntriesReadOnly({
          agentId: target.agentId,
          storePath: target.storePath,
          projection: "list",
        })) {
          const owner = parseAgentSessionKey(row.sessionKey)?.agentId;
          if (owner && owner !== agentId) continue;
          sessions.set(row.sessionKey, withReadMarkers(row, markers));
        }
      }
    } catch (error) {
      // An agent still starting up must not hide every other agent's threads. Only its own refusal is skipped.
      if (!readAgentDatabaseAdmissionRefusal(agentId)) {
        throw error;
      }
      unavailableAgentIds.push(agentId);
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
  // Working comes from the live run registry, as sessions.list's hasActiveRun does; the stored
  // writer id outlives a restart.
  const activeRun = createVisibleActiveSessionRunProjector(context);
  return {
    ...projectContacts({
      isWorking: (row) =>
        activeRun({
          requestedKey: row.sessionKey,
          canonicalKey: row.sessionKey,
          sessionId: row.entry.sessionId,
          agentId: parseAgentSessionKey(row.sessionKey)?.agentId ?? roster.defaultId,
          defaultAgentId: roster.defaultId,
        }).active,
      agents,
      defaultAgentId: roster.defaultId,
      mainKey: roster.mainKey,
      sessionScope: roster.scope,
      includeDefault: !allowedAgents || allowedAgents.has(roster.defaultId),
      sessions: visible,
      previews,
      titles,
      outsidePeers: withOutsideAgents(listA2aPeers(cfg)),
    }),
    sessionKeys: new Set(visible.map((row) => row.sessionKey)),
    unavailableAgentIds,
  };
}

/** Configured A2A peers plus the outside agents that said hello through `branch mcp serve`. */
function withOutsideAgents<T extends ReturnType<typeof listA2aPeers>[number]>(configured: T[]) {
  return [...configured, ...outsideAgentPeers(listOutsideAgents(), configured)];
}

/** Remove a grafted Branch's device pairing through upstream's own device.pair.remove handler (its authz check,
 *  token invalidation, client disconnect and audit event). An already removed pairing is not an error. */
async function removeGraftDevice(
  options: GatewayRequestHandlerOptions,
  deviceId: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof errorShape> }> {
  return await new Promise((resolve) => {
    void deviceHandlers["device.pair.remove"]!({
      ...options,
      params: { deviceId },
      respond: (ok, _payload, error) => {
        if (ok || /unknown deviceId/.test(error?.message ?? "")) resolve({ ok: true });
        else
          resolve({
            ok: false,
            error: error ?? errorShape(ErrorCodes.UNAVAILABLE, "remove failed"),
          });
      },
    });
  });
}

export const contactHandlers: GatewayRequestHandlers = {
  "graft.work.send": async ({ params, respond, client, context }) => {
    const p = params && typeof params === "object" ? params as Record<string, unknown> : {};
    const target = typeof p.target === "string" ? p.target.replace(/^a2a:/, "") : "";
    const text = typeof p.text === "string" ? p.text.trim() : "";
    const sourceSessionKey = typeof p.sourceSessionKey === "string" ? p.sourceSessionKey : "";
    const idempotencyKey = typeof p.idempotencyKey === "string" ? p.idempotencyKey : undefined;
    const sourceAgentId = parseAgentSessionKey(sourceSessionKey)?.agentId;
    if (!target || !text || !sourceAgentId || graftDeviceId(client)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "A local Trunk, grafted target and message are required."));
      return;
    }
    const records = listOutsideAgents();
    const trunk = records.find((row) => row.id === target && row.kind === "trunk");
    const branch = records.find((row) => row.id === trunk?.via && row.kind === "branch");
    if (!trunk?.trunkId || !trunk.deviceId || !branch || branch.deviceId !== trunk.deviceId ||
        outsideAgentRefusal(trunk) || outsideAgentRefusal(branch)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "That Trunk is not linked to this Branch."));
      return;
    }
    if (!outsideAgentMayMessage(context.getRuntimeConfig(), sourceAgentId, target)) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Agent-to-agent messaging denied by agentToAgent policy."));
      return;
    }
    const job = enqueueGraftWork({ deviceId: trunk.deviceId, trunkId: trunk.trunkId, text, sourceSessionKey, sourceAgentId, idempotencyKey });
    respond(true, { id: job.id, status: "accepted" });
  },
  "graft.work.poll": async ({ respond, client }) => {
    const deviceId = graftDeviceId(client);
    if (!deviceId || !listOutsideAgents().some((row) => row.kind === "branch" && row.deviceId === deviceId && !outsideAgentRefusal(row))) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "A joined Branch must poll using its paired device."));
      return;
    }
    const job = claimGraftWork(deviceId);
    respond(true, { job: job ? { id: job.id, trunkId: job.trunkId, text: job.text, sourceAgentId: job.sourceAgentId } : null });
  },
  "graft.work.complete": async ({ params, respond, client, context }) => {
    const p = params && typeof params === "object" ? params as Record<string, unknown> : {};
    const deviceId = graftDeviceId(client);
    const id = typeof p.id === "string" ? p.id : "";
    const reply = typeof p.reply === "string" ? p.reply : undefined;
    const error = typeof p.error === "string" ? p.error : undefined;
    if (!deviceId || !id || (!reply && !error)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "A paired work result is required."));
      return;
    }
    const before = getGraftWork(id);
    const job = completeGraftWork(id, deviceId, { reply, error });
    if (!job) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "Work does not belong to this paired Branch."));
      return;
    }
    respond(true, { status: "recorded" });
    if (before?.completedAt) return;
    const { runAgentStep } = await import("../../agents/tools/agent-step.js");
    const { callGateway } = await import("../call.js");
    void runAgentStep({
      agentId: job.sourceAgentId,
      sessionKey: job.sourceSessionKey,
      sourceTool: "sessions_send",
      message: error ? `The joined Trunk could not complete the request: ${error}` : reply!,
      extraSystemPrompt: "A Trunk on a joined Branch returned the result of your earlier sessions_send request. This result is delivered once; do not resend your request unless the user asks.",
      timeoutMs: 60_000,
      callGateway: (request) => callGateway(request),
    }).catch((failure: unknown) => context.logGateway.warn(`graft work reply delivery failed: ${String(failure)}`));
  },
  "a2a.peers.list": async ({ context, respond }) => {
    const configured = listA2aPeers(context.getRuntimeConfig());
    const records = new Map(listOutsideAgents().map((row) => [row.id, row]));
    const outside = outsideAgentPeers([...records.values()], configured).map((peer) => ({
      ...peer,
      online: isOutsideAgentOnline(records.get(peer.name)!),
    }));
    respond(true, { peers: [...configured, ...outside] });
  },
  "contacts.outside.hello": async ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateContactsOutsideHelloParams,
        "contacts.outside.hello",
        respond,
      )
    )
      return;
    let settings = readOutsideAgentSettings();
    const records = listOutsideAgents();
    // A grafted Branch (a scoped paired device) keeps its own rows; it never takes another's. A goodbye keeps
    // the id the session had; any other hello may get <id>-N while another session holds the id.
    const deviceId = graftDeviceId(client);
    const id =
      deviceId || params.leaving ? params.agent.id : assignOutsideAgentId(params.agent, records);
    const deviceRefusal = outsideAgentDeviceRefusal(
      { ...params.agent, id },
      deviceId,
      records,
      settings,
    );
    // Re-paired after Disconnect (a new code, approved): it takes its rows back.
    if (!deviceRefusal && !params.leaving) {
      settings = reclaimDeviceRow(id, deviceId, records) ?? settings;
    }
    const refusal = deviceRefusal ?? outsideAgentRefusal({ ...params.agent, id }, settings);
    if (refusal) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, refusal));
      return;
    }
    const record = recordOutsideAgent({ ...params.agent, id }, Date.now(), undefined, {
      leaving: params.leaving === true,
      deviceId,
    });
    context.broadcast("contacts.changed", { ts: Date.now() }, { dropIfSlow: true });
    respond(true, {
      contact: { id: `a2a:${record.id}`, name: record.name, where: record.where ?? null },
      mayDriveWindow: outsideAgentMayDriveWindow(record.id, settings),
    });
  },
  "contacts.outside.list": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateContactsOutsideListParams,
        "contacts.outside.list",
        respond,
      )
    )
      return;
    const settings = readOutsideAgentSettings();
    const agents = listOutsideAgents().map((row) => ({
      ...row,
      contactId: `a2a:${row.id}`,
      online: isOutsideAgentOnline(row) && !outsideAgentRefusal(row, settings),
      revoked: Boolean(outsideAgentRefusal(row, { ...settings, enabled: true })),
      mayDriveWindow: outsideAgentMayDriveWindow(row.id, settings),
    }));
    respond(true, { enabled: settings.enabled, agents });
  },
  "contacts.outside.set": async (options) => {
    const { params, respond, context } = options;
    if (
      !assertValidParams(params, validateContactsOutsideSetParams, "contacts.outside.set", respond)
    )
      return;
    if ((params.revoked !== undefined || params.mayDriveWindow !== undefined) && !params.id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Name the agent (id)"));
      return;
    }
    // Disconnecting a grafted Branch (or one of its Trunks) disconnects the whole device: every row it said hello
    // as, and its pairing, removed the way Settings › Devices removes one (device.pair.remove).
    const device =
      params.revoked === true ? outsideAgentDeviceRows(params.id!, listOutsideAgents()) : undefined;
    if (device) {
      const removed = await removeGraftDevice(options, device.deviceId);
      if (!removed.ok) {
        respond(false, undefined, removed.error);
        return;
      }
    }
    let settings = updateOutsideAgentSettings(params);
    for (const other of device?.ids.filter((id) => id !== params.id) ?? []) {
      settings = updateOutsideAgentSettings({ id: other, revoked: true });
    }
    if (params.revoked === true) {
      // Include legacy/product-wide revocations as well as every row belonging to a grafted device.
      const revokedIds = new Set([
        params.id!,
        ...(device?.ids ?? []),
        ...listOutsideAgents()
          .filter((row) => outsideAgentRefusal(row, { ...settings, enabled: true }))
          .map((row) => row.id),
      ]);
      for (const room of removeOutsideRoomMembers([...revokedIds])) {
        context.broadcast("rooms.changed", { roomId: room.roomId, room }, { dropIfSlow: true });
      }
    }
    context.broadcast("contacts.changed", { ts: Date.now() }, { dropIfSlow: true });
    respond(true, settings);
  },
  // Branch-to-Branch: `branch graft join` saved a host while this gateway runs; start (or sync) its link.
  "graft.links.sync": async ({ respond, context }) => {
    const { ensureGraftLinks } = await import("../../mcp/graft-link.js");
    const links = ensureGraftLinks((line) => context.logGateway.info(line));
    respond(true, { links: links.states() });
  },
  "graft.links.list": async ({ respond }) => {
    const { readGraftLinks } = await import("../../mcp/graft-join.js");
    respond(true, { links: readGraftLinks().map(({ url, name, joinedAt }) => ({ url, name, joinedAt })) });
  },
  "graft.links.forget": async ({ params, respond, context }) => {
    const url = params && typeof params === "object" ? (params as { url?: unknown }).url : undefined;
    if (typeof url !== "string" || !url.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Choose a linked Branch to forget."));
      return;
    }
    const { readGraftLinks, forgetGraftLink } = await import("../../mcp/graft-join.js");
    if (!readGraftLinks().some((link) => link.url === url)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "That Branch is not linked."));
      return;
    }
    forgetGraftLink(url);
    const { ensureGraftLinks } = await import("../../mcp/graft-link.js");
    ensureGraftLinks((line) => context.logGateway.info(line));
    respond(true, { forgotten: url });
  },
  "graft.join": async ({ params, respond }) => {
    const input = params && typeof params === "object" ? params as Record<string, unknown> : {};
    if (typeof input.code !== "string" || !input.code.trim() ||
        (input.name !== undefined && typeof input.name !== "string")) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Enter a setup code and an optional name."));
      return;
    }
    try {
      const { joinGraftFromWindow } = await import("../graft-join-ui.js");
      respond(true, await joinGraftFromWindow(input.code, typeof input.name === "string" ? input.name : undefined));
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)));
    }
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
      respond(
        false,
        undefined,
        projection.unavailableAgentIds.length > 0
          ? errorShape(ErrorCodes.UNAVAILABLE, startingUpMessage(projection.unavailableAgentIds))
          : errorShape(ErrorCodes.INVALID_REQUEST, "Unknown contact"),
      );
      return;
    }
    const keys = [
      contact.threadKey,
      ...projection.topics
        .filter((topic) => topic.contactId === contact.id)
        .map((topic) => topic.key),
    ].filter((key) => projection.sessionKeys.has(key));
    sessionMutationAuthorization?.assertCurrent();
    const result = applyReadMutation({
      mutationId: params.mutationId ?? randomUUID(),
      scopes: keys,
      nowMs: Date.now(),
    });
    if (result.applied) {
      for (const sessionKey of keys) {
        emitSessionsChanged(context, { sessionKey, reason: "read" });
      }
    }
    respond(true, { updated: keys.length });
  },
  "contacts.markAllRead": async (options) => {
    const { params, respond, context, sessionMutationAuthorization } = options;
    if (!assertValidParams(params, validateContactsMarkAllReadParams, "contacts.markAllRead", respond))
      return;
    // One shared-state write, no agent database and no projection: nothing here waits on agent readiness.
    sessionMutationAuthorization?.assertCurrent();
    const result = applyReadMutation({
      mutationId: params.mutationId,
      scopes: params.sessionKeys ?? [ALL_THREADS_SCOPE],
      nowMs: Date.now(),
    });
    if (result.applied && params.sessionKeys) {
      for (const sessionKey of params.sessionKeys) {
        emitSessionsChanged(context, { sessionKey, reason: "read" });
      }
    } else if (result.applied) {
      // Every thread changed, so open windows must reload the contact roster and thread lists.
      context.broadcast("contacts.changed", { ts: Date.now() }, { dropIfSlow: true });
    }
    respond(true, result);
  },
};
