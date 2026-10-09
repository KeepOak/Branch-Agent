import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenWatchInbox } from "./frame-inbox.js";
import { SCREEN_WATCH_PULL_WAIT_MS, SCREEN_WATCH_STALE_MS } from "./protocol.js";

const frame = (n: number) => ({
  mime: "image/jpeg",
  data: "AAECAw==",
  width: 800 + n,
  height: 600,
  capturedAtMs: 1_000 + n,
});

describe("ScreenWatchInbox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a newer frame at once and keeps only the latest one", async () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("s1", 0);
    expect(inbox.push("s1", frame(1), 0)).toBe(1);
    expect(inbox.push("s1", frame(2), 0)).toBe(2);
    await expect(inbox.pull("s1", 0, 1_000, 0)).resolves.toEqual({ seq: 2, frame: frame(2) });
  });

  it("waits for the next frame and resolves when it is pushed", async () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("s1", 0);
    const waiting = inbox.pull("s1", 0, 1_000, 0);
    inbox.push("s1", frame(1), 0);
    await expect(waiting).resolves.toEqual({ seq: 1, frame: frame(1) });
  });

  it("returns empty after the wait with no new frame", async () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("s1", 0);
    const waiting = inbox.pull("s1", 0, 1_000, 0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toEqual({ seq: 0 });
  });

  it("clamps a requested wait to the pull cap", async () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("s1", 0);
    const waiting = inbox.pull("s1", 0, 60_000, 0);
    await vi.advanceTimersByTimeAsync(SCREEN_WATCH_PULL_WAIT_MS);
    await expect(waiting).resolves.toEqual({ seq: 0 });
  });

  it("does not wake a pull that is already ahead of the stream", async () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("s1", 0);
    inbox.push("s1", frame(1), 0);
    const waiting = inbox.pull("s1", 5, 1_000, 0);
    inbox.push("s1", frame(2), 0);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toEqual({ seq: 2 });
  });

  it("closes a watch and wakes its waiting pulls with the reason", async () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("s1", 0);
    const waiting = inbox.pull("s1", 0, 1_000, 0);
    inbox.close("s1", "Stopped.");
    await expect(waiting).resolves.toEqual({ seq: 0, closed: "Stopped." });
    await expect(inbox.pull("s1", 0, 1_000, 0)).resolves.toMatchObject({ closed: expect.any(String) });
  });

  it("refuses frames for a watch that is not open, and frames that are off-shape", () => {
    const inbox = new ScreenWatchInbox();
    expect(() => inbox.push("missing", frame(1), 0)).toThrow("The watch is not open.");
    inbox.open("s1", 0);
    expect(() => inbox.push("s1", { ...frame(1), mime: "image/gif" }, 0)).toThrow("invalid screen frame");
  });

  it("stops watches with no pull or push for the stale window and keeps active ones", () => {
    const inbox = new ScreenWatchInbox();
    inbox.open("quiet", 0);
    inbox.open("busy", 0);
    inbox.push("busy", frame(1), SCREEN_WATCH_STALE_MS - 1);
    expect(inbox.sweep(SCREEN_WATCH_STALE_MS)).toEqual(["quiet"]);
    expect(() => inbox.push("quiet", frame(1), SCREEN_WATCH_STALE_MS)).toThrow("The watch is not open.");
    expect(() => inbox.push("busy", frame(2), SCREEN_WATCH_STALE_MS)).not.toThrow();
  });
});
