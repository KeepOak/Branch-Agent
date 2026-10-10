import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addQueueItem, claimNextQueueItem } from "./trunk-queue.js";
import { registerTeam, teamMembers } from "./trunk-team-registry.js";

let env: NodeJS.ProcessEnv;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-team-claim-"));
  env = { ...process.env, BRANCH_STATE_DIR: dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("team-only jobs", () => {
  it("lets a registered member claim its team's job and keeps other builders out", () => {
    registerTeam("2d60428e", { roomId: "team-2d60428e", members: ["builder-scout-2d60428e"] }, env);
    addQueueItem({ title: "Scout: Ship it", brief_text: "Find.", team: "2d60428e" }, env, 1_000);

    expect(claimNextQueueItem("builder-other", env, 1_100)).toBeUndefined();
    expect(claimNextQueueItem("builder-scout-2d60428e", env, 1_200)?.title).toBe("Scout: Ship it");
  });

  it("keeps a team job unclaimable while its team is not registered", () => {
    addQueueItem({ title: "Orphan", brief_text: "Find.", team: "deadbeef" }, env, 1_000);

    expect(claimNextQueueItem("builder-scout-deadbeef", env, 1_100)).toBeUndefined();
  });

  it("still lets any eligible Trunk take an ordinary job", () => {
    addQueueItem({ title: "Plain", brief_text: "Do it." }, env, 1_000);

    expect(claimNextQueueItem("builder-other", env, 1_100)?.title).toBe("Plain");
  });

  it("returns the registered members", () => {
    registerTeam("aaaaaaaa", { roomId: "team-aaaaaaaa", members: ["m1", "m2", "m1"] }, env);

    expect(teamMembers("aaaaaaaa", env)).toEqual(["m1", "m2"]);
    expect(teamMembers("missing", env)).toBeUndefined();
  });
});
