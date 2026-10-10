import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { roomMergeHandlers } from "../server-methods/rooms-merge.js";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";
import { formatMergeSentence, recordRoomMerge } from "./merge-feed.js";
import { createRoom, readRoomLog } from "./store.js";

// A sentence ends at terminal punctuation followed by a space or the end of the text.
const sentenceEnds = (text: string) => text.match(/[.!?\u2026]+(?=\s|$)/gu) ?? [];

describe("merge feed sentence", () => {
  it("is one plain sentence that leads with the running count", () => {
    const text = formatMergeSentence(107, {
      number: 1088,
      title: "fix(ci): list the workflows the recheck reacts to, so the trigger is valid",
    });
    expect(text).toBe(
      "That's 107 merged: #1088 fix(ci): list the workflows the recheck reacts to, so the trigger is valid.",
    );
    expect(sentenceEnds(text)).toHaveLength(1);
  });

  it("keeps a multi-sentence or multi-line title to one sentence", () => {
    const text = formatMergeSentence(3, {
      number: 12,
      title: "  feat: ship v1.2 rooms.\nNo more drift!  Done...  ",
    });
    expect(text).toBe("That's 3 merged: #12 feat: ship v1.2 rooms; No more drift; Done.");
    expect(text).not.toMatch(/\n/);
    expect(sentenceEnds(text)).toHaveLength(1);
  });

  it("refuses a count that is not a positive whole number", () => {
    expect(() => formatMergeSentence(0, { number: 1, title: "x" })).toThrow(/count/);
  });
});

describe("merge feed in a room", () => {
  let directory: string;
  let previous: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-merge-feed-"));
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

  const ownerRoom = () =>
    createRoom({
      name: "Owner",
      members: [{ kind: "trunk", id: "scout", role: "lead", enabled: true }],
    });

  it("posts exactly one sentence per merge, counting up, and ignores a repeat", () => {
    const room = ownerRoom();
    const first = recordRoomMerge(room.roomId, {
      repo: "KeepOak/Branch-Agent",
      number: 1087,
      title: "feat(rooms): one",
    });
    const second = recordRoomMerge(room.roomId, {
      repo: "KeepOak/Branch-Agent",
      number: 1088,
      title: "fix(ci): two",
    });
    const repeat = recordRoomMerge(room.roomId, {
      repo: "KeepOak/Branch-Agent",
      number: 1088,
      title: "fix(ci): two",
    });
    expect(first?.payload).toMatchObject({
      count: 1,
      text: "That's 1 merged: #1087 feat(rooms): one.",
    });
    expect(second?.payload).toMatchObject({
      count: 2,
      text: "That's 2 merged: #1088 fix(ci): two.",
    });
    expect(repeat).toBeUndefined();
    const merges = readRoomLog(room.roomId).events.filter((event) => event.kind === "merge");
    expect(merges).toHaveLength(2);
    for (const event of merges) {
      expect(sentenceEnds((event.payload as { text: string }).text)).toHaveLength(1);
    }
  });

  it("rooms.merge.record posts one event, broadcasts it once, and reports a repeat", async () => {
    const room = ownerRoom();
    const call = async () => {
      const respond = vi.fn();
      const broadcast = vi.fn();
      await roomMergeHandlers["rooms.merge.record"]!({
        params: {
          roomId: room.roomId,
          repo: "KeepOak/Branch-Agent",
          number: 1088,
          title: "fix(ci): two",
        },
        respond,
        context: { broadcast },
      } as unknown as GatewayRequestHandlerOptions);
      return { respond, broadcast };
    };
    const once = await call();
    expect(once.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        recorded: true,
        event: expect.objectContaining({
          kind: "merge",
          payload: expect.objectContaining({
            count: 1,
            text: "That's 1 merged: #1088 fix(ci): two.",
          }),
        }),
      }),
    );
    expect(once.broadcast).toHaveBeenCalledTimes(1);
    const again = await call();
    expect(again.respond).toHaveBeenCalledWith(true, { recorded: false });
    expect(again.broadcast).not.toHaveBeenCalled();
    expect(readRoomLog(room.roomId).events.filter((event) => event.kind === "merge")).toHaveLength(
      1,
    );
  });

  it("rooms.merge.record refuses a missing room", async () => {
    const respond = vi.fn();
    await roomMergeHandlers["rooms.merge.record"]!({
      params: { roomId: "nope", repo: "KeepOak/Branch-Agent", number: 1, title: "x" },
      respond,
      context: { broadcast: vi.fn() },
    } as unknown as GatewayRequestHandlerOptions);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});
