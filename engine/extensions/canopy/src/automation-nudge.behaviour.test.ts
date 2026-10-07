// Written by Branch for MULTI-AGENT-0148 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/workboard/src/automation-nudge.ts; fixtures follow upstream lifecycle-sync.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchPluginService } from "../api.js";
import { createCanopyAutomationNudgeService } from "./automation-nudge.js";
import { createLinkedCard } from "./lifecycle-sync.test-support.js";
import { createCanopySqliteTestStore } from "./test/sqlite-store.js";

type Context = Parameters<BranchPluginService["start"]>[0];
type Cron = NonNullable<ReturnType<NonNullable<Context["getCron"]>>>;

function context(enqueueRun: NonNullable<Cron["enqueueRun"]>): Context {
  const unused = () => {
    throw new Error("Unexpected scheduler mutation");
  };
  return {
    config: {},
    stateDir: "unused",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getCron: () => ({
      enqueueRun,
      list: unused,
      add: unused,
      update: unused,
      remove: unused,
      removeStaleJobFamily: unused,
    }),
  };
}

async function fixture() {
  const store = createCanopySqliteTestStore();
  await store.upsertBoard({ id: "planning", automationJobId: "planning-job" });
  await store.upsertBoard({ id: "review", automationJobId: "review-job" });
  await store.upsertBoard({ id: "manual" });
  const cards = await Promise.all(
    ["planning", "planning", "review", "manual"].map((boardId) =>
      createLinkedCard(store, { boardId }),
    ),
  );
  const enqueue = vi
    .fn<NonNullable<Cron["enqueueRun"]>>()
    .mockResolvedValue({ ok: true, queued: true, runId: "nudge-run" });
  const service = createCanopyAutomationNudgeService({ store });
  const ctx = context(enqueue);
  await service.start(ctx);
  return { store, cards, enqueue, service, ctx };
}

afterEach(() => vi.useRealTimers());

describe("Canopy automation nudge behaviour", () => {
  it("requests each attached board once and reopens its cooldown after 60 seconds", async () => {
    const { cards, enqueue, service, ctx } = await fixture();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      await service.nudge({ cards });
      expect(enqueue.mock.calls).toEqual([
        ["planning-job", "if-enabled"],
        ["review-job", "if-enabled"],
      ]);
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "canopy automation nudge requested for board planning: job planning-job run nudge-run",
      );
      await vi.advanceTimersByTimeAsync(59_999);
      await service.nudge({ cards });
      expect(enqueue).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await service.nudge({ cards });
      expect(enqueue.mock.calls).toEqual([
        ["planning-job", "if-enabled"],
        ["review-job", "if-enabled"],
        ["planning-job", "if-enabled"],
        ["review-job", "if-enabled"],
      ]);
    } finally {
      service.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["cron:planning-job", "agent:main:cron:planning-job:run:one"])(
    "prevents a scheduler feedback loop from %s",
    async (sessionKey) => {
      const { cards, enqueue, service } = await fixture();
      try {
        await service.nudge({ cards, sessionKey: ` ${sessionKey} ` });
        await service.nudge({ cards: [] });
        expect(enqueue).not.toHaveBeenCalled();
      } finally {
        service.stop();
      }
    },
  );

  it("keeps an in-flight request fenced beyond the cooldown deadline", async () => {
    const { cards, enqueue, service } = await fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Awaited<ReturnType<NonNullable<Cron["enqueueRun"]>>>>();
    enqueue.mockImplementationOnce(() => {
      entered.resolve();
      return release.promise;
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const input = { cards: [cards[0]!] };
    const pending = service.nudge(input);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(60_001);
      await service.nudge(input);
      expect(enqueue).toHaveBeenCalledExactlyOnceWith("planning-job", "if-enabled");
      release.resolve({ ok: true, queued: true, runId: "first" });
      await pending;
      await vi.advanceTimersByTimeAsync(0);
      await service.nudge(input);
      expect(enqueue).toHaveBeenCalledTimes(2);
    } finally {
      release.resolve({ ok: true, queued: true, runId: "first" });
      await pending;
      service.stop();
    }
  });

  it("warns on disabled jobs and scheduler failures while preserving cards", async () => {
    const { store, cards, enqueue, service, ctx } = await fixture();
    enqueue.mockResolvedValueOnce({ ok: true, ran: false, reason: "disabled" });
    enqueue.mockRejectedValueOnce(new Error("scheduler offline"));
    try {
      await expect(service.nudge({ cards })).resolves.toBeUndefined();
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "canopy automation nudge skipped for board planning: job planning-job disabled",
      );
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        "canopy automation nudge failed for board review: Error: scheduler offline",
      );
      expect(ctx.logger.info).not.toHaveBeenCalled();
      for (const card of cards) {
        await expect(store.get(card.id)).resolves.toEqual(card);
      }
    } finally {
      service.stop();
    }
  });

  it("clears cooldowns on restart and prevents stopped owners from scheduling", async () => {
    const { cards, enqueue, service, ctx } = await fixture();
    const input = { cards: [cards[0]!] };
    try {
      await service.nudge(input);
      service.stop();
      await service.nudge(input);
      expect(enqueue).toHaveBeenCalledOnce();
      await service.start(ctx);
      await service.nudge(input);
      expect(enqueue.mock.calls).toEqual([
        ["planning-job", "if-enabled"],
        ["planning-job", "if-enabled"],
      ]);
    } finally {
      service.stop();
    }
  });
});
