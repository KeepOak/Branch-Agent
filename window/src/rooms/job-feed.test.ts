import { describe, expect, it } from "vitest";
import { jobNotices, type FeedEvent, type TrunkNames } from "./job-feed";

const names: TrunkNames = (id) => (id === "nas-builder-2" ? "Builder 2" : null);
const job = (seq: number, payload: unknown, createdAt = seq * 100): FeedEvent => ({ seq, kind: "job", actorId: "nas-builder-2", payload, createdAt });
const claimed = (seq: number, jobId = "j1", title = "Quote sheet") => job(seq, { text: `nas-builder-2 picked up: ${title}`, transition: "claimed", jobId, title });
const done = (seq: number, jobId = "j1", title = "Quote sheet") => job(seq, { text: `nas-builder-2 finished: ${title}, PR #41`, transition: "done", jobId, title });

describe("jobNotices", () => {
  it("collapses one job's transitions into one line with its latest state and every step in order", () => {
    const [line] = jobNotices("r1", [claimed(2), done(3)], names);
    expect(line).toMatchObject({
      kind: "notice",
      key: "room:r1:job:j1",
      text: "Builder 2 finished: Quote sheet, PR #41",
      at: 300,
      steps: [
        { text: "Builder 2 picked up: Quote sheet", at: 200 },
        { text: "Builder 2 finished: Quote sheet, PR #41", at: 300 },
      ],
    });
    expect(jobNotices("r1", [claimed(2), done(3)], names)).toHaveLength(1);
  });

  it("keeps two jobs on separate lines, in the order each job first appeared", () => {
    const lines = jobNotices("r1", [claimed(2, "j1"), claimed(3, "j2", "Site audit"), done(4, "j1")], names);
    expect(lines.map((line) => line.key)).toEqual(["room:r1:job:j1", "room:r1:job:j2"]);
    expect(lines[0]).toMatchObject({ text: "Builder 2 finished: Quote sheet, PR #41" });
    expect(lines[1]).toMatchObject({ text: "Builder 2 picked up: Site audit" });
  });

  it("keeps a job's key when its next transition arrives, so an open line stays open", () => {
    const before = jobNotices("r1", [claimed(2)], names);
    const after = jobNotices("r1", [claimed(2), done(3)], names);
    expect(after[0]!.key).toBe(before[0]!.key);
  });

  it("shows the Trunk's display name, never its raw id", () => {
    const lines = jobNotices("r1", [claimed(2), done(3)], names);
    expect(JSON.stringify(lines)).not.toContain("nas-builder-2");
    expect(lines[0]).toMatchObject({ text: "Builder 2 finished: Quote sheet, PR #41" });
  });

  it("falls back to a neutral name, never the raw id, when the window does not know the Trunk", () => {
    const lines = jobNotices("r1", [claimed(2), done(3)], () => null);
    expect(lines[0]).toMatchObject({ text: "A Trunk finished: Quote sheet, PR #41", steps: [{ text: "A Trunk picked up: Quote sheet" }, { text: "A Trunk finished: Quote sheet, PR #41" }] });
    expect(JSON.stringify(lines)).not.toContain("nas-builder-2");
  });

  it("skips an event with no Trunk id, since its sentence would show a raw id", () => {
    const noActor: FeedEvent = { seq: 2, kind: "job", payload: { text: "nas-builder-2 picked up: Quote sheet", transition: "claimed", jobId: "j1" }, createdAt: 200 };
    const lines = jobNotices("r1", [noActor], names);
    expect(lines).toEqual([]);
  });

  it("skips malformed job events and never shows a raw field", () => {
    const lines = jobNotices("r1", [
      job(2, { transition: "claimed", jobId: "j1", title: "No sentence" }),
      job(3, { text: "nas-builder-2 picked up: Stray", transition: "started", jobId: "j1" }),
      job(4, { text: "nas-builder-2 picked up: Anonymous", transition: "claimed" }),
      job(5, null),
      job(6, { text: "   ", transition: "done", jobId: "j1" }),
    ], names);
    expect(lines).toEqual([]);
  });

  it("ignores room events that are not job transitions", () => {
    expect(jobNotices("r1", [{ seq: 1, kind: "created", payload: { members: [] }, createdAt: 1 }], names)).toEqual([]);
  });

  it("orders each job's steps by event sequence, even when events arrive out of order", () => {
    const [line] = jobNotices("r1", [done(3), claimed(2)], names);
    expect(line).toMatchObject({ text: "Builder 2 finished: Quote sheet, PR #41", steps: [{ at: 200 }, { at: 300 }] });
  });
});
