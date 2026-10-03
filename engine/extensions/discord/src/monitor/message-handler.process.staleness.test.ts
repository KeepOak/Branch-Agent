import { describe, expect, it, vi } from "vitest";
import {
  createAutomaticSourceDeliveryContext,
  deliverDiscordReply,
  dispatchInboundMessageForTest as dispatchInboundMessage,
  registerDiscordProcessTestLifecycle,
  runProcessDiscordMessage,
} from "./message-handler.process.test-harness.js";
import { recordDiscordChannelMessageSeen } from "./staleness.js";

registerDiscordProcessTestLifecycle();

describe("Discord real reply delivery staleness", () => {
  for (const behavior of ["skip", "tag", "ignore"] as const) {
    it(`applies ${behavior} after newer messages arrive during the model turn`, async () => {
      const ctx = await createAutomaticSourceDeliveryContext({
        discordConfig: {
          staleness: { enabled: true, behavior, threshold: 0 },
          streaming: { mode: "off" },
        },
      });
      ctx.stalenessStartSequence = recordDiscordChannelMessageSeen(
        ctx.client,
        ctx.messageChannelId,
        "first",
      );
      dispatchInboundMessage.mockImplementationOnce(async (params) => {
        recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "newer");
        await params?.dispatcher.sendFinalReply({ text: "old answer" });
        await params?.dispatcher.waitForIdle();
        return { queuedFinal: true, counts: { final: 1, tool: 0, block: 0 } };
      });
      await runProcessDiscordMessage(ctx);
      if (behavior === "skip") {
        expect(deliverDiscordReply).not.toHaveBeenCalled();
      } else {
        expect(deliverDiscordReply).toHaveBeenCalledTimes(1);
        expect(deliverDiscordReply.mock.calls[0]?.[0]).toMatchObject({
          replies: [{ text: behavior === "tag" ? "(catching up:) old answer" : "old answer" }],
        });
      }
    });
  }

  it("uses receipt sequence when newer ingress arrived before processing started", async () => {
    const ctx = await createAutomaticSourceDeliveryContext({
      discordConfig: {
        staleness: { enabled: true, behavior: "skip", threshold: 0 },
        streaming: { mode: "off" },
      },
    });
    ctx.stalenessStartSequence = recordDiscordChannelMessageSeen(
      ctx.client,
      ctx.messageChannelId,
      "first",
    );
    recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "newer");
    dispatchInboundMessage.mockImplementationOnce(async (params) => {
      await params?.dispatcher.sendFinalReply({ text: "old queued answer" });
      await params?.dispatcher.waitForIdle();
      return { queuedFinal: true, counts: { final: 1, tool: 0, block: 0 } };
    });
    await runProcessDiscordMessage(ctx);
    expect(deliverDiscordReply).not.toHaveBeenCalled();
  });

  it("retains existing delivery by default after newer messages", async () => {
    const ctx = await createAutomaticSourceDeliveryContext({
      discordConfig: { streaming: { mode: "off" } },
    });
    ctx.stalenessStartSequence = recordDiscordChannelMessageSeen(
      ctx.client,
      ctx.messageChannelId,
      "first",
    );
    recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "newer");
    dispatchInboundMessage.mockImplementationOnce(async (params) => {
      await params?.dispatcher.sendFinalReply({ text: "answer" });
      await params?.dispatcher.waitForIdle();
      return { queuedFinal: true, counts: { final: 1, tool: 0, block: 0 } };
    });
    await runProcessDiscordMessage(ctx);
    expect(deliverDiscordReply).toHaveBeenCalledTimes(1);
  });
});

describe("Discord ingress staleness receipt", () => {
  it("retains the ingress sequence before asynchronous preflight sees newer messages", async () => {
    const { createDiscordMessageDispatcher } = await import("./message-dispatcher.js");
    const { createDiscordHandlerParams } = await import("./message-handler.test-helpers.js");
    const params = createDiscordHandlerParams();
    const ctx = await createAutomaticSourceDeliveryContext({ messageChannelId: "receipt-room" });
    const process = vi.fn(async (_ctx: unknown) => {});
    const dispatcher = createDiscordMessageDispatcher({
      ...params,
      dmPolicy: "pairing",
      testing: {
        preflightDiscordMessage: async () => {
          recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "newer");
          return ctx;
        },
        processDiscordMessage: process,
      },
    });
    try {
      await dispatcher(
        {
          channel_id: "receipt-room",
          author: { id: "user-1" },
          message: { id: "first", content: "hello", channel_id: "receipt-room", attachments: [] },
        } as never,
        ctx.client,
      );
      await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
      expect(process.mock.calls[0]?.[0]).toMatchObject({ stalenessStartSequence: 1 });
    } finally {
      await dispatcher.deactivate();
    }
  });
});
