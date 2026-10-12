import { resolveCanonicalMainSessionKey } from "../config/sessions/main-session-key.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createAgentToAgentPolicy } from "../plugin-sdk/session-visibility.js";
import { sanitizeForPromptLiteral } from "./sanitize-for-prompt.js";

export type ContactsRoomContext = {
  title: string;
  members: readonly { id: string; name: string }[];
  /** Rooms containing people must not receive roster information. */
  hasPeople?: boolean;
};

function display(value: string): string {
  return sanitizeForPromptLiteral(value).trim();
}

/** A deterministic, config-derived roster for the stable system-prompt prefix. */
export function buildContactsSection(params: {
  config: BranchConfig;
  agentId: string;
  availableTools: ReadonlySet<string>;
  room?: ContactsRoomContext;
  chatType?: string;
}): string[] {
  if (
    params.room?.hasPeople ||
    (!params.room && ["group", "channel"].includes(params.chatType ?? ""))
  ) {
    return [];
  }
  const entries = params.config.agents?.entries ?? {};
  const selfName = display(entries[params.agentId]?.name || "this Trunk");
  if (params.room) {
    const members = params.room.members
      .filter((member) => member.id !== params.agentId)
      .map((member) => display(member.name))
      .filter(Boolean);
    return [
      "## Your contacts",
      `You are ${selfName} in ${display(params.room.title)}. Other Trunks in this room:`,
      ...(members.length ? members.map((name) => `- ${name}`) : ["- None"]),
      "Refer to members by name, never by internal ID. Discuss only this room's work here.",
      "",
    ];
  }

  const policy = createAgentToAgentPolicy(params.config);
  const canSend = params.availableTools.has("sessions_send");
  const contacts = canSend
    ? Object.entries(entries)
        .filter(([id]) => id !== params.agentId && policy.isAllowed(params.agentId, id))
        .map(([id, entry]) => {
          const name = display(entry.name || "Trunk");
          const description = display(entry.description || "");
          const sessionKey = resolveCanonicalMainSessionKey({
            agentId: id,
            mainKey: params.config.session?.mainKey,
          });
          return { name, description, sessionKey };
        })
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, "en") || a.sessionKey.localeCompare(b.sessionKey, "en"),
        )
    : [];
  const a2aConfig = params.config.channels?.a2a as
    | { enabled?: boolean; peers?: Record<string, { url?: string }> }
    | undefined;
  const peers =
    params.availableTools.has("message") && a2aConfig?.enabled !== false
      ? Object.entries(a2aConfig?.peers ?? {})
          .filter(
            ([id, peer]) => Boolean(peer.url) && policy.isAllowed(params.agentId, `a2a:${id}`),
          )
          .map(([id, peer]) => {
            const name = display(
              id.replace(/[._-]+/gu, " ").replace(/\b\w/gu, (char) => char.toUpperCase()),
            );
            const host = new URL(peer.url as string).host;
            return `- ${name} on ${host} (A2A): message tool, channel a2a, to ${id}`;
          })
          .sort((a, b) => a.localeCompare(b, "en"))
      : [];
  return [
    "## Your contacts",
    `You are ${selfName}. Other Trunks on this Branch, and agents you can reach:`,
    ...(contacts.length || peers.length
      ? [
          ...contacts.map(
            ({ name, description, sessionKey }) =>
              `- ${name}${description ? `: ${description}.` : "."} Message: sessions_send to ${sessionKey}`,
          ),
          ...peers,
        ]
      : ["- None available."]),
    "Refer to contacts by name in user-facing text, never by internal ID. Contacts you may not message are not listed.",
    "",
  ];
}
