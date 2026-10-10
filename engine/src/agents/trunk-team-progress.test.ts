import { describe, expect, it } from "vitest";
import type { QueueTransition } from "./trunk-queue.js";
import { teamOfJob, teamProgressPost } from "./trunk-team-progress.js";

const TEAM_BRIEF = "Find the sources.\n\nGoal: Ship it\n\n<!-- team:2d60428e:scout|Scout -->";
const item = (brief_text: string, extra: Record<string, unknown> = {}) =>
  ({
    id: "job-1",
    title: "Scout: Ship it",
    brief_text,
    priority: 0,
    added_at: 1,
    ...extra,
  }) as QueueTransition["item"];
const roomOk = () => true;

describe("teamOfJob", () => {
  it("reads the team and role from a team job's marker", () => {
    expect(teamOfJob(TEAM_BRIEF)).toEqual({ teamId: "2d60428e", slug: "scout", role: "Scout" });
  });

  it("returns nothing for an ordinary job", () => {
    expect(teamOfJob("Fix the invoice export.")).toBeUndefined();
  });
});

describe("teamProgressPost", () => {
  it("writes one plain line per transition, from the Trunk that did the work", () => {
    const claimed = teamProgressPost(
      { kind: "claimed", item: item(TEAM_BRIEF), agentId: "builder-scout-2d60428e" },
      roomOk,
    );
    expect(claimed).toEqual({
      roomId: "team-2d60428e",
      actorId: "builder-scout-2d60428e",
      text: 'Builder Scout picked up "Scout: Ship it".',
    });
    const done = teamProgressPost({ kind: "done", item: item(TEAM_BRIEF) }, roomOk);
    expect(done?.text).toBe('Builder Scout finished "Scout: Ship it".');
    expect(done?.actorId).toBe("builder-scout-2d60428e");
    expect(
      teamProgressPost({ kind: "released", item: item(TEAM_BRIEF), agentId: "a" }, roomOk)?.text,
    ).toBe('Builder Scout handed "Scout: Ship it" back to the queue.');
    expect(teamProgressPost({ kind: "blocked", item: item(TEAM_BRIEF) }, roomOk)?.text).toBe(
      'Builder Scout is stuck on "Scout: Ship it" and needs a look.',
    );
  });

  it("posts nothing for an ordinary job, a missing room, or a job with no Trunk to name", () => {
    expect(
      teamProgressPost({ kind: "done", item: item("Fix the invoice export.") }, roomOk),
    ).toBeUndefined();
    expect(teamProgressPost({ kind: "done", item: item(TEAM_BRIEF) }, () => false)).toBeUndefined();
  });
});
