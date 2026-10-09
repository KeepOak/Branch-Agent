import { afterEach, expect, it, vi } from "vitest";
import { createTurnMemoryAdmission, requiresHeavyTurnMemory } from "./agent-memory-admission.js";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  totalmem: () => 32 * 1024 ** 3,
}));

afterEach(() => vi.useRealTimers());

it("the eighth heavy run stays queued and starts when memory frees", async () => {
  vi.useFakeTimers();
  let free = 11 * 1024 ** 3;
  const acquire = createTurnMemoryAdmission(() => free);
  const onWait = vi.fn();
  const options = {
    heavy: true,
    settings: { reserveMb: 4096, estimatedRunMb: 1024 },
    signal: new AbortController().signal,
    onWait,
  };
  const releases = [];
  for (let i = 0; i < 7; i++) {
    releases.push(await acquire(options));
  }
  let started = false;
  const eighth = acquire(options).then((release) => {
    started = true;
    return release;
  });
  expect(onWait).toHaveBeenLastCalledWith(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(started).toBe(false);
  free += 1024 ** 3;
  await vi.advanceTimersByTimeAsync(500);
  const releaseEighth = await eighth;
  expect(started).toBe(true);
  releases.forEach((release) => release());
  releaseEighth();
});

it("a chat-only turn is never blocked behind heavy turns", async () => {
  vi.useFakeTimers();
  const memory = vi.fn(() => 0);
  const acquire = createTurnMemoryAdmission(memory);
  const controller = new AbortController();
  const onWait = vi.fn();
  const queued = acquire({ heavy: true, signal: controller.signal, onWait });
  const cancelled = expect(queued).rejects.toThrow();
  const chatWait = vi.fn();
  const release = await acquire({
    heavy: requiresHeavyTurnMemory({ workKind: "chat", lane: "subagent" }),
    signal: new AbortController().signal,
    onWait: chatWait,
  });
  expect(chatWait).not.toHaveBeenCalled();
  expect(memory).toHaveBeenCalledOnce();
  release();
  controller.abort();
  await cancelled;
});

it("cancelled waiters leave the FIFO and update the number ahead", async () => {
  vi.useFakeTimers();
  let free = 0;
  const acquire = createTurnMemoryAdmission(() => free);
  const first = new AbortController();
  const second = new AbortController();
  const onWait = vi.fn();
  const queued = acquire({ heavy: true, signal: first.signal, onWait: () => {} });
  const cancelled = expect(queued).rejects.toThrow();
  const next = acquire({ heavy: true, signal: second.signal, onWait });
  expect(onWait).toHaveBeenLastCalledWith(1);
  first.abort();
  await cancelled;
  await vi.advanceTimersByTimeAsync(500);
  expect(onWait).toHaveBeenLastCalledWith(0);
  free = 16 * 1024 ** 3;
  await vi.advanceTimersByTimeAsync(500);
  (await next)();
});

it("the off setting bypasses probing and model-only turns never request memory", async () => {
  const memory = vi.fn(() => 0);
  const onWait = vi.fn();
  (
    await createTurnMemoryAdmission(memory)({
      heavy: true,
      settings: { enabled: false },
      signal: new AbortController().signal,
      onWait,
    })
  )();
  expect(memory).not.toHaveBeenCalled();
  expect(onWait).not.toHaveBeenCalled();
  expect(requiresHeavyTurnMemory({ modelRun: true, workKind: "heavy", lane: "subagent" })).toBe(
    false,
  );
  expect(requiresHeavyTurnMemory({})).toBe(false);
  expect(requiresHeavyTurnMemory({ lane: "subagent" })).toBe(true);
  expect(requiresHeavyTurnMemory({ workKind: "heavy" })).toBe(true);
});

it("default-on admission protects the reserve and completion releases its budget once", async () => {
  vi.useFakeTimers();
  const acquire = createTurnMemoryAdmission(() => 8 * 1024 ** 3);
  const onWait = vi.fn();
  const options = { heavy: true, signal: new AbortController().signal, onWait };
  const releaseFirst = await acquire(options);
  const second = acquire(options);
  expect(onWait).toHaveBeenCalledWith(0);
  releaseFirst();
  releaseFirst();
  await vi.advanceTimersByTimeAsync(500);
  const releaseSecond = await second;
  const third = acquire(options);
  expect(onWait).toHaveBeenCalledTimes(2);
  releaseSecond();
  await vi.advanceTimersByTimeAsync(500);
  (await third)();
});
