// Behaviour tests for atlas SAFETY-0200 (G-1680, G-1681, G-1683, G-1722) and SAFETY-0118 (G-1680).
import { describe, expect, it } from "vitest";
import { decideChatOwnerCommand, resolveCommandAuthorization } from "../auto-reply/command-auth.js";
import { installDiscordRegistryHooks } from "../auto-reply/test-helpers/command-auth-registry-fixture.js";
import {
  acceptEditedMessage,
  CHAT_PAIRING_PROPOSAL_MAX,
  CHAT_PAIRING_PROPOSAL_TTL_MS,
  ChatPairingProposalQueue,
  isNamedOwnerAccount,
} from "./chat-owner-authority.js";

installDiscordRegistryHooks();

const owner = { channel: "telegram", senderId: "100" };
const friend = { channel: "telegram", senderId: "200" };
const base = {
  sender: owner,
  namedOwners: [owner],
  chatType: "direct" as const,
  replayed: false,
  command: "control" as const,
  lockdownOn: false,
  appLocked: false,
  conversationHasActiveTasks: false,
};

describe("G-1680 named owner accounts", () => {
  it("G-1680: a chat account is the owner only when the owner named it; pairing alone never is", () => {
    expect(isNamedOwnerAccount(owner, [owner])).toBe(true);
    expect(isNamedOwnerAccount(friend, [owner])).toBe(false);
    expect(isNamedOwnerAccount(owner, [])).toBe(false);
    expect(isNamedOwnerAccount({ channel: "discord", senderId: "100" }, [owner])).toBe(false);
  });
});

describe("G-1681 owner commands from chat", () => {
  it("G-1681: the named owner in a direct chat runs owner commands; in a group the owner is an ordinary sender", () => {
    const cfg = { channels: { discord: {} }, commands: { ownerAllowFrom: ["456"] } };
    const ctx = (ChatType: string) => ({ Provider: "discord", Surface: "discord", ChatType, From: "discord:456", SenderId: "456" });
    expect(resolveCommandAuthorization({ ctx: ctx("direct"), cfg, commandAuthorized: true }).senderIsOwner).toBe(true);
    expect(resolveCommandAuthorization({ ctx: ctx("group"), cfg, commandAuthorized: true }).senderIsOwner).toBe(false);
    expect(resolveCommandAuthorization({ ctx: ctx("channel"), cfg, commandAuthorized: true }).senderIsOwner).toBe(false);
  });

  it("G-1681: replayed commands are ignored and anyone else's command is ordinary content", () => {
    expect(decideChatOwnerCommand({ ...base, replayed: true })).toEqual({ kind: "content" });
    expect(decideChatOwnerCommand({ ...base, sender: friend })).toEqual({ kind: "content" });
    expect(decideChatOwnerCommand({ ...base, chatType: "group" })).toEqual({ kind: "content" });
    expect(decideChatOwnerCommand(base)).toEqual({ kind: "run", preserveConversation: false });
  });

  it("G-1681: under Lockdown or App lock only Lockdown-on is accepted, and Lockdown-off is local only", () => {
    for (const flags of [{ lockdownOn: true }, { appLocked: true }]) {
      expect(decideChatOwnerCommand({ ...base, ...flags })).toEqual({ kind: "content" });
      expect(decideChatOwnerCommand({ ...base, ...flags, command: "lockdown-on" })).toEqual({
        kind: "run",
        preserveConversation: false,
      });
    }
    expect(decideChatOwnerCommand({ ...base, command: "lockdown-off" })).toEqual({ kind: "local-only" });
  });

  it("G-1681: conversations with running or waiting tasks are preserved", () => {
    expect(decideChatOwnerCommand({ ...base, command: "reset", conversationHasActiveTasks: true })).toEqual({
      kind: "run",
      preserveConversation: true,
    });
  });
});

describe("G-1683 edited messages", () => {
  it("G-1683: an edit counts only from the original sender, on a message the agent read", () => {
    expect(acceptEditedMessage({ editor: owner, original: { sender: owner, readByAgent: true } })).toBe(true);
    expect(acceptEditedMessage({ editor: friend, original: { sender: owner, readByAgent: true } })).toBe(false);
    expect(acceptEditedMessage({ editor: owner, original: { sender: owner, readByAgent: false } })).toBe(false);
    expect(acceptEditedMessage({ editor: owner, original: undefined })).toBe(false);
  });
});

describe("G-1722 pairing proposals from chat", () => {
  it("G-1722: a chat pairing request is a short-lived proposal with the exact channel, sender and device", () => {
    let now = 0;
    const queue = new ChatPairingProposalQueue(() => now);
    const proposal = queue.propose({ channel: "telegram", senderId: "200", deviceLabel: "Pixel" });
    expect(proposal).toMatchObject({ channel: "telegram", senderId: "200", deviceLabel: "Pixel" });
    now += CHAT_PAIRING_PROPOSAL_TTL_MS + 1;
    expect(queue.list()).toEqual([]);
  });

  it("G-1722: approval, owner identity and allowlist are re-checked when consumed, and the queue is bounded", () => {
    const queue = new ChatPairingProposalQueue(() => 0);
    const ok = { senderApproved: true, ownerIdentityCurrent: true, allowlisted: true };
    const a = queue.propose({ channel: "telegram", senderId: "200" });
    expect(queue.consume(a.id, { ...ok, ownerIdentityCurrent: false })).toBeUndefined();
    expect(queue.consume(a.id, ok)).toBeUndefined();
    const b = queue.propose({ channel: "telegram", senderId: "201" });
    expect(queue.consume(b.id, ok)?.senderId).toBe("201");
    for (let i = 0; i < CHAT_PAIRING_PROPOSAL_MAX + 5; i += 1) {
      queue.propose({ channel: "telegram", senderId: `s${i}` });
    }
    expect(queue.list()).toHaveLength(CHAT_PAIRING_PROPOSAL_MAX);
    expect(new ChatPairingProposalQueue().list()).toEqual([]);
  });
});
