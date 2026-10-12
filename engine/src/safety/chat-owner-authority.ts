// Branch-original shared safety piece (atlas SAFETY-0200): chat-app identity facts and helpers. The owner
// decision itself is the ordered check in auto-reply/command-auth.ts.
import { randomBytes } from "node:crypto";

export type ChatSender = Readonly<{ channel: string; accountId?: string; senderId: string }>;

const senderKey = (sender: ChatSender): string =>
  `${sender.channel.trim().toLowerCase()}:${sender.accountId?.trim() ?? ""}:${sender.senderId.trim()}`;

/**
 * G-1680: a chat account is the owner only when the owner named it, exactly. Being paired or allowlisted gives
 * a sender access, never owner commands; with nothing named, nobody in chat is the owner.
 */
export function isNamedOwnerAccount(sender: ChatSender, namedOwners: readonly ChatSender[]): boolean {
  const key = senderKey(sender);
  return namedOwners.some((owner) => senderKey(owner) === key);
}

/** G-1681: the chat shape owner commands need: a direct chat. Groups and channels never carry owner authority. */
export function isOwnerChatShape(chatType: string | undefined): boolean {
  return chatType !== "group" && chatType !== "channel";
}

/** G-1683: an edit counts only from the original message's own sender, on a message the agent read. */
export function acceptEditedMessage(params: {
  editor: ChatSender;
  original: { sender: ChatSender; readByAgent: boolean } | undefined;
}): boolean {
  const original = params.original;
  return Boolean(original?.readByAgent && senderKey(original.sender) === senderKey(params.editor));
}

export const CHAT_PAIRING_PROPOSAL_TTL_MS = 10 * 60_000;
export const CHAT_PAIRING_PROPOSAL_MAX = 20;

export type ChatPairingProposal = Readonly<{
  id: string;
  channel: string;
  senderId: string;
  accountId?: string;
  deviceLabel?: string;
  expiresAt: number;
}>;

export type ProposalRecheck = Readonly<{
  senderApproved: boolean;
  ownerIdentityCurrent: boolean;
  allowlisted: boolean;
}>;

/**
 * G-1722: a pairing request from chat only creates a short-lived proposal shown in the local window with the
 * exact channel, sender and device. The queue is bounded, lives in memory (a restart discards it), and
 * approval, owner identity and allowlist are checked again when the proposal is consumed.
 */
export class ChatPairingProposalQueue {
  private readonly proposals = new Map<string, ChatPairingProposal>();

  constructor(private readonly now: () => number = Date.now) {}

  propose(request: Omit<ChatPairingProposal, "id" | "expiresAt">): ChatPairingProposal {
    this.prune();
    const duplicate = [...this.proposals.values()].find(
      (item) => item.channel === request.channel && item.senderId === request.senderId && item.accountId === request.accountId,
    );
    if (duplicate) {
      return duplicate;
    }
    if (this.proposals.size >= CHAT_PAIRING_PROPOSAL_MAX) {
      const oldest = this.proposals.keys().next().value;
      if (oldest !== undefined) {
        this.proposals.delete(oldest);
      }
    }
    const proposal = Object.freeze({
      ...request,
      id: randomBytes(16).toString("base64url"),
      expiresAt: this.now() + CHAT_PAIRING_PROPOSAL_TTL_MS,
    });
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  list(): ChatPairingProposal[] {
    this.prune();
    return [...this.proposals.values()];
  }

  /** One use. Expired proposals, or a failed re-check, consume nothing into access. */
  consume(id: string, recheck: ProposalRecheck): ChatPairingProposal | undefined {
    this.prune();
    const proposal = this.proposals.get(id);
    this.proposals.delete(id);
    if (!proposal || !recheck.senderApproved || !recheck.ownerIdentityCurrent || !recheck.allowlisted) {
      return undefined;
    }
    return proposal;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, proposal] of this.proposals) {
      if (now > proposal.expiresAt) {
        this.proposals.delete(id);
      }
    }
  }
}
