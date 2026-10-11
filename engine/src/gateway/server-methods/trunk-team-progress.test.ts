import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueTransition } from "../../agents/trunk-queue.js";

const mocks = vi.hoisted(() => ({
  listener: undefined as ((t: QueueTransition) => void) | undefined,
  rooms: new Set<string>(),
  appended: [] as unknown[][],
}));

vi.mock("../../agents/trunk-queue.js", () => ({
  setQueueTransitionListener: (fn: ((t: QueueTransition) => void) | undefined) => {
    mocks.listener = fn;
  },
}));
vi.mock("../rooms/store.js", () => ({
  getRoom: (roomId: string) => (mocks.rooms.has(roomId) ? { roomId } : undefined),
  appendRoomEvent: (...args: unknown[]) => {
    mocks.appended.push(args);
    return { roomId: args[0], seq: 1 };
  },
}));

const { attachTeamProgress } = await import("./trunk-team-progress.js");

const TEAM_BRIEF = "Find the sources.\n\n<!-- team:2d60428e:scout|Scout -->";
const teamItem = (brief_text: string) =>
  ({
    id: "j",
    title: "Scout: Ship it",
    brief_text,
    priority: 0,
    added_at: 1,
  }) as QueueTransition["item"];

beforeEach(() => {
  mocks.listener = undefined;
  mocks.rooms.clear();
  mocks.appended.length = 0;
});

describe("attachTeamProgress", () => {
  it("writes a team job's line into its group room and broadcasts it", () => {
    mocks.rooms.add("team-2d60428e");
    const broadcast = vi.fn();
    attachTeamProgress(broadcast);

    mocks.listener?.({
      kind: "claimed",
      item: teamItem(TEAM_BRIEF),
      agentId: "builder-scout-2d60428e",
    });

    expect(mocks.appended).toEqual([
      [
        "team-2d60428e",
        "message",
        "builder-scout-2d60428e",
        { text: 'Builder Scout picked up "Scout: Ship it".' },
      ],
    ]);
    expect(broadcast).toHaveBeenCalledWith("rooms.event", expect.anything(), { dropIfSlow: true });
  });

  it("stays silent for ordinary jobs and for teams whose room is gone", () => {
    const broadcast = vi.fn();
    attachTeamProgress(broadcast);

    mocks.listener?.({ kind: "done", item: teamItem("Fix the invoice export.") });
    mocks.listener?.({ kind: "done", item: teamItem(TEAM_BRIEF) });

    expect(mocks.appended).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
