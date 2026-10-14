import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { startRoomMergeWatcher } from "../server-lifetime-sidecars.js";
import { roomMergeHandlers } from "../server-methods/rooms-merge.js";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";
import {
  followRoomMerges,
  parseMergedPullRequest,
  pollRoomMergeFollows,
  type MergedPullRequest,
} from "./merge-watch.js";
import { archiveRoom, createRoom, readRoomLog } from "./store.js";

const REPO = "KeepOak/Branch-Agent";
const merges = (roomId: string) =>
  readRoomLog(roomId).events.filter((event) => event.kind === "merge");
const texts = (roomId: string) =>
  merges(roomId).map((event) => (event.payload as { text: string }).text);

describe("merge feed watcher", () => {
  let directory: string;
  let previous: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-merge-watch-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
  });
  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) {
      delete process.env.BRANCH_STATE_DIR;
    } else {
      process.env.BRANCH_STATE_DIR = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  const ownerRoom = (name = "Owner") =>
    createRoom({ name, members: [{ kind: "trunk", id: "scout", role: "lead", enabled: true }] });

  it("follows a repository once and keeps the first start time", () => {
    const room = ownerRoom();
    const first = followRoomMerges(room.roomId, REPO, "main", 1_000);
    const again = followRoomMerges(room.roomId, REPO, "main", 9_000);
    expect(first.event?.kind).toBe("merge.follow");
    expect(first.event?.payload).toMatchObject({
      text: "Following merges to KeepOak/Branch-Agent main",
    });
    expect(again.event).toBeUndefined();
    expect(again.follow.since).toBe(1_000);
    expect(() => followRoomMerges("nope", REPO)).toThrow(/Room not found/);
  });

  it("records each new merge once, in merge order, and leaves out earlier merges and other bases", async () => {
    const room = ownerRoom();
    followRoomMerges(room.roomId, REPO, "main", 1_000);
    const merged: MergedPullRequest[] = [
      { number: 1090, title: "feat: second", base: "main", mergedAt: 3_000 },
      { number: 1089, title: "fix: first", base: "main", mergedAt: 2_000 },
      { number: 1001, title: "before the follow", base: "main", mergedAt: 500 },
      { number: 1091, title: "into a stack", base: "trunk/other", mergedAt: 2_500 },
    ];
    const fetchMerged = vi.fn(async () => merged);
    const broadcast = vi.fn();
    const recorded = await pollRoomMergeFollows({ fetchMerged, broadcast });
    expect(fetchMerged).toHaveBeenCalledWith(REPO);
    expect(recorded).toHaveLength(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(texts(room.roomId)).toEqual([
      "That's 1 merged: #1089 fix: first.",
      "That's 2 merged: #1090 feat: second.",
    ]);
    // The next pass sees the same pull requests plus one new merge and posts only the new one.
    merged.push({ number: 1092, title: "feat: third", base: "main", mergedAt: 4_000 });
    expect(await pollRoomMergeFollows({ fetchMerged, broadcast })).toHaveLength(1);
    expect(texts(room.roomId).at(-1)).toBe("That's 3 merged: #1092 feat: third.");
    expect(broadcast).toHaveBeenCalledTimes(3);
  });

  it("fetches a repository once for every room that follows it and skips archived rooms", async () => {
    const one = ownerRoom("One");
    const two = ownerRoom("Two");
    const gone = ownerRoom("Gone");
    for (const room of [one, two, gone]) {
      followRoomMerges(room.roomId, REPO, "main", 1_000);
    }
    archiveRoom(gone.roomId);
    const fetchMerged = vi.fn(async () => [
      { number: 7, title: "feat: shared", base: "main", mergedAt: 2_000 },
    ]);
    await pollRoomMergeFollows({ fetchMerged, broadcast: vi.fn() });
    expect(fetchMerged).toHaveBeenCalledTimes(1);
    expect(texts(one.roomId)).toEqual(["That's 1 merged: #7 feat: shared."]);
    expect(texts(two.roomId)).toEqual(["That's 1 merged: #7 feat: shared."]);
  });

  it("warns and keeps going when GitHub cannot be read", async () => {
    const room = ownerRoom();
    followRoomMerges(room.roomId, REPO, "main", 1_000);
    const warn = vi.fn();
    const recorded = await pollRoomMergeFollows({
      fetchMerged: async () => {
        throw new Error("rate limited");
      },
      broadcast: vi.fn(),
      warn,
    });
    expect(recorded).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rate limited"));
  });

  it("reads only merged pull requests from GitHub's list", () => {
    const base = { number: 5, title: "feat: x", base: { ref: "main" } };
    expect(parseMergedPullRequest({ ...base, merged_at: "2026-10-11T21:00:00Z" })).toEqual({
      number: 5,
      title: "feat: x",
      base: "main",
      mergedAt: Date.parse("2026-10-11T21:00:00Z"),
    });
    expect(parseMergedPullRequest({ ...base, merged_at: null })).toBeUndefined();
    expect(parseMergedPullRequest(null)).toBeUndefined();
  });

  it("rooms.merge.follow starts the follow, broadcasts it once, and reports a repeat", async () => {
    const room = ownerRoom();
    const call = async () => {
      const respond = vi.fn();
      const broadcast = vi.fn();
      await roomMergeHandlers["rooms.merge.follow"]!({
        params: { roomId: room.roomId, repo: REPO },
        respond,
        context: { broadcast },
      } as unknown as GatewayRequestHandlerOptions);
      return { respond, broadcast };
    };
    const once = await call();
    expect(once.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ following: true, created: true }),
    );
    expect(once.broadcast).toHaveBeenCalledWith(
      "rooms.event",
      expect.objectContaining({ kind: "merge.follow" }),
      { dropIfSlow: true },
    );
    const again = await call();
    expect(again.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ following: true, created: false }),
    );
    expect(again.broadcast).not.toHaveBeenCalled();
  });

  it("the gateway's timer records a followed merge and broadcasts it as a room event", async () => {
    const room = ownerRoom();
    followRoomMerges(room.roomId, REPO, "main", 1_000);
    let run: (() => unknown) | undefined;
    const scheduler = {
      now: () => 0,
      schedule: vi.fn((job: { id: string; everyMs?: number; run: () => unknown }) => {
        run = job.run;
        return { stop: vi.fn() };
      }),
    };
    const broadcast = vi.fn();
    startRoomMergeWatcher({
      scheduler: scheduler as never,
      context: { broadcast } as never,
      logWarning: vi.fn(),
      fetchMerged: async () => [
        { number: 1107, title: "feat(rooms): merge feed", base: "main", mergedAt: 2_000 },
      ],
    });
    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rooms:merge-feed", everyMs: 120_000 }),
    );
    await run?.();
    expect(texts(room.roomId)).toEqual(["That's 1 merged: #1107 feat(rooms): merge feed."]);
    expect(broadcast).toHaveBeenCalledWith(
      "rooms.event",
      expect.objectContaining({ kind: "merge", roomId: room.roomId }),
      { dropIfSlow: true },
    );
  });
});
