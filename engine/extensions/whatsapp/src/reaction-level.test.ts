// Whatsapp tests cover reaction level plugin behavior.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { resolveWhatsAppReactionLevel } from "./reaction-level.js";

describe("resolveWhatsAppReactionLevel", () => {
  it("defaults to minimal level when reactionLevel is not set", () => {
    const cfg: BranchConfig = {
      channels: { whatsapp: {} },
    };

    const result = resolveWhatsAppReactionLevel({ cfg });
    expect(result).toEqual({
      level: "minimal",
      ackEnabled: false,
      agentReactionsEnabled: true,
      agentReactionGuidance: "minimal",
    });
  });

  it("returns off level with no reactions enabled", () => {
    const cfg: BranchConfig = {
      channels: { whatsapp: { reactionLevel: "off" } },
    };

    const result = resolveWhatsAppReactionLevel({ cfg });
    expect(result).toEqual({
      level: "off",
      ackEnabled: false,
      agentReactionsEnabled: false,
    });
  });

  it("returns ack level with only ackEnabled", () => {
    const cfg: BranchConfig = {
      channels: { whatsapp: { reactionLevel: "ack" } },
    };

    const result = resolveWhatsAppReactionLevel({ cfg });
    expect(result).toEqual({
      level: "ack",
      ackEnabled: true,
      agentReactionsEnabled: false,
    });
  });

  it("resolves reaction level from a specific account", () => {
    const cfg: BranchConfig = {
      channels: {
        whatsapp: {
          reactionLevel: "minimal",
          accounts: {
            work: { reactionLevel: "extensive" },
          },
        },
      },
    };

    const result = resolveWhatsAppReactionLevel({ cfg, accountId: "work" });
    expect(result).toEqual({
      level: "extensive",
      ackEnabled: false,
      agentReactionsEnabled: true,
      agentReactionGuidance: "extensive",
    });
  });
});
