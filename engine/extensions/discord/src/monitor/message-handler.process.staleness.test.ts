import { describe, expect, it, vi } from "vitest";
import {
  BASE_CHANNEL_ROUTE,
  createAutomaticSourceDeliveryContext,
  createDiscordDraftStream,
  createMockDraftStream,
  dispatchBufferedReplyForTest,
  getSessionEntry,
  readLatestAssistantTextByIdentity,
  typingMocksForTest,
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

  it("restores the complete transcript before tagging an already stale final", async () => {
    const prefix =
      "Here is the complete Discord answer with enough stable prefix text before truncation";
    const fullAnswer = `${prefix} ${"complete continuation ".repeat(120)}`.trimEnd();
    const ctx = await createAutomaticSourceDeliveryContext({
      baseSessionKey: BASE_CHANNEL_ROUTE.sessionKey,
      route: BASE_CHANNEL_ROUTE,
      discordConfig: {
        staleness: { enabled: true, behavior: "tag", threshold: 0 },
        streaming: { mode: "off" },
      },
    });
    ctx.stalenessStartSequence = recordDiscordChannelMessageSeen(
      ctx.client,
      ctx.messageChannelId,
      "first",
    );
    recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "newer");
    getSessionEntry.mockReturnValue({ sessionId: "session-1" });
    readLatestAssistantTextByIdentity.mockResolvedValue({
      text: fullAnswer,
      timestamp: Date.now() + 60_000,
    });
    dispatchInboundMessage.mockImplementationOnce(async (params) => {
      await params?.dispatcher.sendFinalReply({ text: `${prefix}...` });
      await params?.dispatcher.waitForIdle();
      return { queuedFinal: true, counts: { final: 1, tool: 0, block: 0 } };
    });
    await runProcessDiscordMessage(ctx);
    expect(readLatestAssistantTextByIdentity).toHaveBeenCalledOnce();
    expect(deliverDiscordReply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        replies: [expect.objectContaining({ text: `(catching up:) ${fullAnswer}` })],
      }),
    );
  });

  for (const boundary of ["transcript", "typing", "preview discard"] as const) {
    for (const behavior of ["skip", "tag"] as const) {
      it(`applies ${behavior} to ingress during awaited ${boundary}`, async () => {
        const entered = deferred<void>();
        const release = deferred<void>();
        const prefix =
          "Here is the complete Discord answer with enough stable prefix text before truncation";
        const fullAnswer = `${prefix} ${"complete continuation ".repeat(120)}`.trimEnd();
        const ctx = await createAutomaticSourceDeliveryContext({
          baseSessionKey: BASE_CHANNEL_ROUTE.sessionKey,
          route: BASE_CHANNEL_ROUTE,
          cfg: { messages: { statusReactions: { enabled: false } } },
          discordConfig: {
            staleness: { enabled: true, behavior, threshold: 0 },
            streaming: { mode: boundary === "preview discard" ? "partial" : "off" },
          },
        });
        ctx.stalenessStartSequence = recordDiscordChannelMessageSeen(
          ctx.client,
          ctx.messageChannelId,
          "first",
        );
        const wait = async () => {
          entered.resolve();
          await release.promise;
        };
        if (boundary === "transcript") {
          getSessionEntry.mockReturnValue({ sessionId: "session-1" });
          readLatestAssistantTextByIdentity.mockImplementationOnce(async () => {
            await wait();
            return { text: fullAnswer, timestamp: Date.now() + 60_000 };
          });
        } else if (boundary === "typing") {
          typingMocksForTest.sendTyping.mockImplementationOnce(wait);
        } else {
          const draft = createMockDraftStream();
          draft.discardPending.mockImplementationOnce(wait);
          createDiscordDraftStream.mockReturnValueOnce(draft);
        }
        dispatchInboundMessage.mockImplementationOnce(async (params) => {
          await params?.dispatcher.sendFinalReply({
            text: boundary === "transcript" ? `${prefix}...` : "old answer",
          });
          await entered.promise;
          expect(deliverDiscordReply).not.toHaveBeenCalled();
          recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "during-wait");
          release.resolve();
          await params?.dispatcher.waitForIdle();
          return { queuedFinal: true, counts: { final: 1, tool: 0, block: 0 } };
        });
        await runProcessDiscordMessage(ctx);
        if (behavior === "skip") {
          expect(deliverDiscordReply).not.toHaveBeenCalled();
        } else {
          expect(deliverDiscordReply).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              replies: [
                expect.objectContaining({
                  text: `(catching up:) ${boundary === "transcript" ? fullAnswer : "old answer"}`,
                }),
              ],
            }),
          );
        }
      });
    }
  }

  for (const behavior of ["skip", "tag"] as const) {
    it(`rechecks ${behavior} before adopting progress after its flush wait`, async () => {
      const ctx = await createAutomaticSourceDeliveryContext({
        cfg: { messages: { statusReactions: { enabled: false } } },
        discordConfig: {
          staleness: { enabled: true, behavior, threshold: 0 },
          streaming: { mode: "progress", progress: { label: false, toolProgress: true } },
        },
      });
      ctx.stalenessStartSequence = recordDiscordChannelMessageSeen(
        ctx.client,
        ctx.messageChannelId,
        "first",
      );
      const draft = createMockDraftStream();
      let deliveryStarted = false;
      let ingressDuringFlush = false;
      draft.flush.mockImplementation(async () => {
        if (deliveryStarted && !ingressDuringFlush) {
          await Promise.resolve();
          recordDiscordChannelMessageSeen(ctx.client, ctx.messageChannelId, "during-flush");
          ingressDuringFlush = true;
        }
      });
      createDiscordDraftStream.mockReturnValueOnce(draft);
      const adopt = vi.fn(async () => true);
      dispatchBufferedReplyForTest.mockImplementationOnce(async (params) => {
        await params.replyOptions?.onPlanUpdate?.({
          phase: "update",
          steps: [{ step: "Verify result", status: "in_progress" }],
        });
        const payload = { text: "Waiting for result." };
        await params.dispatcherOptions.beforeDeliver?.(payload, { kind: "final" });
        deliveryStarted = true;
        await params.dispatcherOptions.deliver(payload, {
          kind: "final",
          adoptProgressContinuation: adopt,
        });
        return { queuedFinal: true, counts: { final: 1, tool: 0, block: 0 } };
      });
      await runProcessDiscordMessage(ctx);
      expect(draft.flush).toHaveBeenCalled();
      expect(ingressDuringFlush).toBe(true);
      expect(adopt).not.toHaveBeenCalled();
      if (behavior === "skip") {
        expect(deliverDiscordReply).not.toHaveBeenCalled();
      } else {
        expect(deliverDiscordReply).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ replies: [{ text: "(catching up:) Waiting for result." }] }),
        );
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
