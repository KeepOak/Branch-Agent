// Behaviour tests for atlas SAFETY-0200 (G-1681): a named owner account carries owner authority only in a direct chat.
import { describe, expect, it } from "vitest";
import { resolveCommandAuthorization } from "../auto-reply/command-auth.js";
import { installDiscordRegistryHooks } from "../auto-reply/test-helpers/command-auth-registry-fixture.js";
import { isOwnerChatShape } from "./chat-owner-authority.js";

installDiscordRegistryHooks();

describe("G-1681 owner commands from chat", () => {
  it("G-1681: the named owner in a direct chat is the owner; in a group or channel the owner is an ordinary sender", () => {
    const cfg = { channels: { discord: {} }, commands: { ownerAllowFrom: ["456"] } };
    const ctx = (ChatType: string | undefined) => ({
      Provider: "discord",
      Surface: "discord",
      ...(ChatType ? { ChatType } : {}),
      From: "discord:456",
      SenderId: "456",
    });
    expect(resolveCommandAuthorization({ ctx: ctx("direct"), cfg, commandAuthorized: true }).senderIsOwner).toBe(true);
    expect(resolveCommandAuthorization({ ctx: ctx(undefined), cfg, commandAuthorized: true }).senderIsOwner).toBe(true);
    for (const shape of ["group", "channel", "thread", "forum"]) {
      expect(resolveCommandAuthorization({ ctx: ctx(shape), cfg, commandAuthorized: true }).senderIsOwner).toBe(false);
    }
  });

  it("G-1681: only direct (or dm) labels, or an unset type, may carry owner authority", () => {
    expect(isOwnerChatShape("direct")).toBe(true);
    expect(isOwnerChatShape("DM")).toBe(true);
    expect(isOwnerChatShape(undefined)).toBe(true);
    expect(isOwnerChatShape("")).toBe(true);
    for (const shape of ["group", "channel", "thread", "forum", "topic"]) {
      expect(isOwnerChatShape(shape)).toBe(false);
    }
  });
});
