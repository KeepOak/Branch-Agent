// Branch-original shared safety piece (atlas SAFETY-0200, G-1681): the chat shape that may carry owner authority.
// The owner decision itself is the ordered check in auto-reply/command-auth.ts.
import { normalizeChatType } from "../channels/chat-type.js";

/**
 * Owner commands need a direct chat. Groups and channels never carry owner authority, and neither does any other
 * non-empty label a channel reports (thread, forum, topic...): normalizeChatType leaves those unrecognized.
 * An unset type keeps today's behaviour (owner by exact identity), because several channel plugins leave
 * ChatType empty on direct messages; refusing it would make the owner's own DMs stricter (page 03 rule 6).
 */
export function isOwnerChatShape(chatType: string | undefined): boolean {
  if (chatType === undefined || chatType.trim() === "") {
    return true;
  }
  return normalizeChatType(chatType) === "direct";
}
