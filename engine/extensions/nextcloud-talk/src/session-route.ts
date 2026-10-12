import { buildChannelOutboundSessionRoute } from "branch/plugin-sdk/channel-core";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { stripNextcloudTalkTargetPrefix } from "./normalize.js";

export function resolveNextcloudTalkOutboundSessionRoute(params: {
  cfg: BranchConfig;
  agentId: string;
  accountId?: string | null;
  target: string;
}) {
  const roomId = stripNextcloudTalkTargetPrefix(params.target);
  if (!roomId) {
    return null;
  }
  return buildChannelOutboundSessionRoute({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: "nextcloud-talk",
    accountId: params.accountId,
    // Room tokens do not reveal whether inbound keys by room or sender id.
    // Keep delivery behavior, but reject this route for explicit session selection.
    recipientSessionExact: false,
    peer: {
      kind: "group",
      id: roomId,
    },
    chatType: "group",
    from: `nextcloud-talk:room:${roomId}`,
    to: `nextcloud-talk:${roomId}`,
  });
}
