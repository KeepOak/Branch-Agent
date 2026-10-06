import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { resolveRelayAccount } from "./accounts.js";
import { chatRelayPlugin } from "./channel.js";
import { buildRelayTarget, parseRelayTarget } from "./target.js";

describe("opt-in chat relay channel", () => {
  const configured = {
    channels: {
      "chat-relay": {
        url: "https://connector.example",
        identities: [{ platform: "discord", botId: "app-1" }],
      },
    },
  } as BranchConfig;

  it("is a loadable bundled channel and stays off until explicitly enabled", () => {
    expect(chatRelayPlugin.id).toBe("chat-relay");
    expect(resolveRelayAccount({ cfg: configured })).toMatchObject({ configured: true, enabled: false });
    const enabled = {
      channels: { "chat-relay": { ...configured.channels?.["chat-relay"], enabled: true } },
    } as BranchConfig;
    expect(resolveRelayAccount({ cfg: enabled }).enabled).toBe(true);
  });

  it("addresses a platform and chat without persisting an owner phone number", () => {
    const target = buildRelayTarget({ platform: "discord", chatType: "channel", chatId: "guild:room" });
    expect(parseRelayTarget(target)).toEqual({ platform: "discord", chatType: "channel", chatId: "guild:room" });
    expect(JSON.stringify(resolveRelayAccount({ cfg: configured }))).not.toMatch(/phone|ownerNumber/u);
  });
});
