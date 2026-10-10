import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoom, readRoomLog } from "../gateway/rooms/store.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import {
  addQueueItem,
  claimNextQueueItem,
  markQueueItemDone,
  pickUpQueuedWork,
  releaseQueueItem,
  releaseStaleQueueClaims,
  STALE_CLAIM_MS,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

const TRUNK = "builder-birch";

type Call = { method: string; params: Record<string, unknown> };

/** A gateway that accepts every call; chat.send fails when failSend is set. */
function fakeGateway({ failSend = false } = {}) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        return { sessions: [] } as T;
      }
      if (method === "chat.send" && failSend) {
        throw new Error("run refused");
      }
      return { runId: "run-1", status: "started" } as T;
    },
  };
  return { gateway, calls };
}

/** Texts of the job events in one room, in order. */
function jobTexts(roomId: string): string[] {
  return readRoomLog(roomId)
    .events.filter((event) => event.kind === "job")
    .map((event) => (event.payload as { text: string }).text);
}

describe("Trunk job room events", () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;
  let previous: string | undefined;
  let inRoom: string;
  let inRoomToo: string;
  let disabled: string;
  let otherTrunk: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-job-room-events-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
    env = { ...process.env, BRANCH_STATE_DIR: directory };
    inRoom = createRoom({
      name: "Build",
      members: [{ kind: "trunk", id: TRUNK, role: "lead", enabled: true }],
    }).roomId;
    inRoomToo = createRoom({
      name: "Ship",
      members: [
        { kind: "trunk", id: "ash", role: "lead", enabled: true },
        { kind: "trunk", id: TRUNK, role: "member", enabled: true },
      ],
    }).roomId;
    disabled = createRoom({
      name: "Paused",
      members: [
        { kind: "trunk", id: "ash", role: "lead", enabled: true },
        { kind: "trunk", id: TRUNK, role: "member", enabled: false },
      ],
    }).roomId;
    otherTrunk = createRoom({
      name: "Elsewhere",
      members: [{ kind: "trunk", id: "ash", role: "lead", enabled: true }],
    }).roomId;
  });

  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) delete process.env.BRANCH_STATE_DIR;
    else process.env.BRANCH_STATE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  it("claim writes one event into each room the Trunk is enabled in, and starts no room turn", async () => {
    addQueueItem({ title: "Build the thing", brief_text: "Do it." }, env, 1_000);
    const { gateway, calls } = fakeGateway();

    await pickUpQueuedWork({ agentId: TRUNK, gateway, env });

    expect(jobTexts(inRoom)).toEqual([`${TRUNK} picked up: Build the thing`]);
    expect(jobTexts(inRoomToo)).toEqual([`${TRUNK} picked up: Build the thing`]);
    expect(jobTexts(disabled)).toEqual([]);
    expect(jobTexts(otherTrunk)).toEqual([]);
    for (const roomId of [inRoom, inRoomToo]) {
      const turnEvents = readRoomLog(roomId).events.filter((event) => event.kind.startsWith("turn."));
      expect(turnEvents).toEqual([]);
    }
    // Only the job's own queue thread is started; no room method is called.
    expect(calls.map((call) => call.method)).toEqual([
      "sessions.list",
      "sessions.create",
      "chat.send",
    ]);
  });

  it("done writes one event with the PR number from the done note, and a repeat writes nothing", () => {
    const job = addQueueItem({ title: "Build the thing", brief_text: "Do it." }, env, 1_000);
    claimNextQueueItem(TRUNK, env, 2_000);

    const note = "Opened https://github.com/KeepOak/Branch-Agent/pull/123";
    markQueueItemDone(job.id, env, 3_000, note);
    markQueueItemDone(job.id, env, 4_000, note);

    expect(jobTexts(inRoom)).toEqual([
      `${TRUNK} picked up: Build the thing`,
      `${TRUNK} finished: Build the thing, PR #123`,
    ]);
    expect(jobTexts(inRoomToo)).toHaveLength(2);
  });

  it("done without a PR in the note writes one event without a PR number", () => {
    const job = addQueueItem({ title: "Write the docs", brief_text: "Do it." }, env, 1_000);
    claimNextQueueItem(TRUNK, env, 2_000);

    markQueueItemDone(job.id, env, 3_000);

    expect(jobTexts(inRoom).at(-1)).toBe(`${TRUNK} finished: Write the docs`);
  });

  it("release writes one event; releasing again with no open claim writes nothing", () => {
    const job = addQueueItem({ title: "Build the thing", brief_text: "Do it." }, env, 1_000);
    claimNextQueueItem(TRUNK, env, 2_000);

    releaseQueueItem(job.id, env, 3_000, undefined, "the run hung");
    releaseQueueItem(job.id, env, 4_000, undefined, "the run hung");

    expect(jobTexts(inRoom)).toEqual([
      `${TRUNK} picked up: Build the thing`,
      `${TRUNK} gave back Build the thing (the run hung)`,
    ]);
  });

  it("a claim left idle past the stale limit is released with one event", async () => {
    addQueueItem({ title: "Build the thing", brief_text: "Do it." }, env, 1_000);
    const claimedAt = 2_000;
    claimNextQueueItem(TRUNK, env, claimedAt);

    await releaseStaleQueueClaims({
      gateway: fakeGateway().gateway,
      env,
      now: () => claimedAt + STALE_CLAIM_MS,
    });

    expect(jobTexts(inRoom)).toEqual([
      `${TRUNK} picked up: Build the thing`,
      `${TRUNK} gave back Build the thing (no run activity for two hours)`,
    ]);
  });

  it("a claim whose run cannot start writes picked-up then released, one event each", async () => {
    addQueueItem({ title: "Build the thing", brief_text: "Do it." }, env, 1_000);
    const { gateway } = fakeGateway({ failSend: true });

    await expect(pickUpQueuedWork({ agentId: TRUNK, gateway, env })).rejects.toThrow(
      "run refused",
    );

    expect(jobTexts(inRoom)).toEqual([
      `${TRUNK} picked up: Build the thing`,
      `${TRUNK} gave back Build the thing (its run could not start)`,
    ]);
  });
});
