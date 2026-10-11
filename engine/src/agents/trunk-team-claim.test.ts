import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addQueueItem, claimNextQueueItem, listQueueItems } from "./trunk-queue.js";
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

describe("team jobs queued before the team field existed", () => {
  it("reads the team from the old marker, so only that team's members can claim the job", () => {
    registerTeam("2d60428e", { roomId: "team-2d60428e", members: ["builder-scout-2d60428e"] }, env);
    addQueueItem(
      { title: "Scout: Ship it", brief_text: "Find.\n\nGoal: Ship it\n\n<!-- team:2d60428e:Scout -->" },
      env,
      1_000,
    );

    expect(listQueueItems(env)[0]?.team).toBe("2d60428e");
    expect(claimNextQueueItem("builder-other", env, 1_100)).toBeUndefined();
    expect(claimNextQueueItem("builder-scout-2d60428e", env, 1_200)?.title).toBe("Scout: Ship it");
  });
});

describe("a corrupt team registry", () => {
  it("keeps the bad file aside, refuses to write, and pauses team jobs with a plain reason", () => {
    const target = path.join(dir, "trunks", "teams.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{not json");
    addQueueItem({ title: "Scout: Ship it", brief_text: "Find.", team: "2d60428e" }, env, 1_000);

    expect(() =>
      registerTeam("aaaaaaaa", { roomId: "team-aaaaaaaa", members: ["m1"] }, env),
    ).toThrow(/was unreadable and was kept at/);
    expect(fs.existsSync(target)).toBe(false);
    const kept = fs
      .readdirSync(path.dirname(target))
      .filter((name) => name.startsWith("teams.json.corrupt-"));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(target), kept[0]!), "utf8")).toBe("{not json");

    expect(() =>
      registerTeam("bbbbbbbb", { roomId: "team-bbbbbbbb", members: ["m2"] }, env),
    ).toThrow(/Nothing was registered/);
    expect(claimNextQueueItem("builder-scout-2d60428e", env, 1_100)).toBeUndefined();
    expect(listQueueItems(env)[0]?.status).toBe("blocked");
    expect(listQueueItems(env)[0]?.blocked_reason).toMatch(/^Team jobs are paused\. .*kept at/);
    expect(listQueueItems(env)[0]?.blocked_reason).toMatch(/setting the teams up again/);
  });
});

describe("team jobs whose team is not set up here", () => {
  it("are blocked with a plain reason until the team is registered, then they run", () => {
    addQueueItem({ title: "Orphan", brief_text: "Find.", team: "deadbeef" }, env, 1_000);

    expect(claimNextQueueItem("builder-scout-deadbeef", env, 1_100)).toBeUndefined();
    const [row] = listQueueItems(env);
    expect(row?.status).toBe("blocked");
    expect(row?.blocked_reason).toBe(
      "Team deadbeef isn't set up on this computer. Set the team up again; the job then runs.",
    );

    registerTeam("deadbeef", { roomId: "team-deadbeef", members: ["builder-scout-deadbeef"] }, env);
    expect(claimNextQueueItem("builder-scout-deadbeef", env, 1_200)?.title).toBe("Orphan");
  });
});

describe("an unreadable team registry", () => {
  it("pauses team jobs with a plain reason and leaves ordinary jobs claimable", () => {
    fs.mkdirSync(path.join(dir, "trunks", "teams.json"), { recursive: true });
    addQueueItem({ title: "Scout: Ship it", brief_text: "Find.", team: "2d60428e" }, env, 1_000);
    addQueueItem({ title: "Plain", brief_text: "Do it." }, env, 1_001);

    expect(claimNextQueueItem("builder-other", env, 1_100)?.title).toBe("Plain");
    const team = listQueueItems(env).find((row) => row.title === "Scout: Ship it");
    expect(team?.status).toBe("blocked");
    expect(team?.blocked_reason).toMatch(/^Team jobs are paused\. .*could not be read/);
    expect(claimNextQueueItem("builder-scout-2d60428e", env, 1_200)).toBeUndefined();
    expect(() => registerTeam("cccccccc", { roomId: "team-cccccccc", members: ["m3"] }, env)).toThrow(
      /could not be read/,
    );
  });
});
