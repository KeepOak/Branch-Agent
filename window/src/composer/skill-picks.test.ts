import { describe, expect, it } from "vitest";
import { leadingCommand, newPick, pickText, reconcilePicks, resolveSend, type SkillPick } from "./skill-picks";

const KEYS = ["clawhub"];
const SEED = pickText("clawhub"); // "/seedbank"

describe("picks run from any position", () => {
  it("a pick at the start runs as the engine key", () => {
    const text = `${SEED} find invoices`;
    expect(resolveSend(text, [newPick(0, "clawhub")], KEYS)).toBe("/clawhub find invoices");
  });

  it("a pick in the middle of a sentence runs as the engine key", () => {
    const text = `before you start, ${SEED} now`;
    expect(resolveSend(text, [newPick(text.indexOf(SEED), "clawhub")], KEYS)).toBe("before you start, /clawhub now");
  });

  it("two picks in one message both run", () => {
    const text = `${SEED} then ${SEED} again`;
    const picks = [newPick(0, "clawhub"), newPick(text.lastIndexOf(SEED), "clawhub")];
    expect(resolveSend(text, picks, KEYS)).toBe("/clawhub then /clawhub again");
  });
});

describe("typed commands run only at the start", () => {
  it("a typed leading /seedbank runs as the engine key, with no pick", () => {
    expect(resolveSend("/seedbank summarize this", [], KEYS)).toBe("/clawhub summarize this");
    expect(resolveSend("/seedbank", [], KEYS)).toBe("/clawhub");
  });

  it("a typed mid-message /seedbank with no pick is prose and stays as written", () => {
    expect(resolveSend("please use /seedbank now", [], KEYS)).toBe("please use /seedbank now");
    expect(resolveSend("ask the seedbank team", [], KEYS)).toBe("ask the seedbank team");
  });

  it("a typed /seedbank after a pick is prose and stays as written", () => {
    const text = `${SEED} then tell me about /seedbank`;
    expect(resolveSend(text, [newPick(0, "clawhub")], KEYS)).toBe("/clawhub then tell me about /seedbank");
  });

  it("keeps /clawhub working as a hidden alias", () => {
    expect(resolveSend("/clawhub summarize this", [], KEYS)).toBe("/clawhub summarize this");
  });

  it("leadingCommand alone does the same leading-only translation", () => {
    expect(leadingCommand("hi /seedbank", KEYS)).toBe("hi /seedbank");
  });
});

describe("pick ranges follow the text", () => {
  it("an edit before a pick moves it", () => {
    const before = `${SEED} now`;
    const after = `hello ${SEED} now`;
    const moved = reconcilePicks([newPick(0, "clawhub")], before, after);
    expect(moved).toEqual([{ start: 6, end: 6 + SEED.length, raw: "clawhub" }]);
    expect(resolveSend(after, moved, KEYS)).toBe("hello /clawhub now");
  });

  it("typing right after a pick keeps it", () => {
    const before = `${SEED} `;
    const after = `${SEED} x`;
    expect(reconcilePicks([newPick(0, "clawhub")], before, after)).toEqual([newPick(0, "clawhub")]);
  });

  it("typing right before a pick keeps it and moves it", () => {
    const before = SEED;
    const after = `x${SEED}`;
    expect(reconcilePicks([newPick(0, "clawhub")], before, after)).toEqual([{ start: 1, end: 1 + SEED.length, raw: "clawhub" }]);
  });

  it("Backspace inside the picked text drops the pick", () => {
    const before = `${SEED} now`;
    const after = `/seedban now`;
    expect(reconcilePicks([newPick(0, "clawhub")], before, after)).toEqual([]);
  });

  it("typing inside the picked text drops the pick", () => {
    const before = `${SEED} now`;
    const after = `/seeXdbank now`;
    expect(reconcilePicks([newPick(0, "clawhub")], before, after)).toEqual([]);
  });

  it("deleting the whole pick drops it", () => {
    expect(reconcilePicks([newPick(0, "clawhub")], `${SEED} now`, " now")).toEqual([]);
  });

  it("a pick whose text no longer matches is not resolved at send time", () => {
    const stale: SkillPick[] = [newPick(0, "clawhub")];
    expect(resolveSend("/seedban now", stale, KEYS)).toBe("/seedban now");
  });
});

describe("no invisible characters reach the engine or the pick", () => {
  it("the pick text and the resolved message carry no hidden characters", () => {
    const text = `${SEED} find invoices`;
    const out = resolveSend(text, [newPick(0, "clawhub")], KEYS);
    expect(SEED).toMatch(/^[\x21-\x7e]+$/);
    expect(out).toMatch(/^[\x20-\x7e]+$/);
  });
});
