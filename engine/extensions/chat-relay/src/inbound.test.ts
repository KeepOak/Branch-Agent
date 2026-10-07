import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
import { describe, expect, it, vi } from "vitest";
import { resolveRelayAccount } from "./accounts.js";
import { handleRelayInbound } from "./inbound.js";

const cfg = {
  channels: {
    "chat-relay": {
      enabled: true,
      url: "https://relay.example",
      identities: [{ platform: "discord", botId: "bot-1" }],
    },
  },
} as BranchConfig;

function createRuntime(commandAuthorized: boolean) {
  const resolveStable = vi.fn(async (_options: unknown) => ({
    ingress: { admission: "dispatch" },
    commandAccess: { authorized: commandAuthorized },
  }));
  const dispatch = vi.fn(async (_request: unknown) => {});
  const channelRuntime = {
    mentions: {
      buildMentionRegexes: vi.fn(() => []),
      matchesMentionPatterns: vi.fn(() => false),
    },
    inbound: {
      ingress: { resolveStable },
      buildContext: (context: unknown) => context,
      dispatch,
    },
  } as unknown as PluginRuntime["channel"];
  return { channelRuntime, resolveStable, dispatch };
}

describe("chat relay inbound access", () => {
  it.each([false, true])("uses ingress command authorization %s", async (authorized) => {
    const { channelRuntime, dispatch } = createRuntime(authorized);
    await handleRelayInbound({
      cfg,
      account: resolveRelayAccount({ cfg }),
      event: {
        text: "/status",
        source: { platform: "discord", chat_id: "dm-1", chat_type: "dm", user_id: "user-1" },
      },
      channelRuntime,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      ctxPayload: { access: { commands: { authorized } } },
    });
  });

  it("defaults to pairing DMs and mention-gated allowlisted groups", async () => {
    const { channelRuntime, resolveStable } = createRuntime(false);
    const account = resolveRelayAccount({ cfg });
    await handleRelayInbound({
      cfg,
      account,
      event: {
        text: "hello",
        source: { platform: "discord", chat_id: "dm-1", chat_type: "dm", user_id: "user-1" },
      },
      channelRuntime,
    });
    await handleRelayInbound({
      cfg,
      account,
      event: {
        text: "hello",
        source: { platform: "discord", chat_id: "room-1", chat_type: "group", user_id: "user-1" },
      },
      channelRuntime,
    });

    expect(resolveStable.mock.calls[0]?.[0]).toMatchObject({
      dmPolicy: "pairing", allowFrom: [],
    });
    expect(resolveStable.mock.calls[1]?.[0]).toMatchObject({
      groupPolicy: "allowlist", groupAllowFrom: [],
      policy: { activation: { requireMention: true } },
    });
  });
});
