import { describe, expect, it } from "vitest";
import { matchAnswer } from "./TalkSetup";
import { asksAgain, doneLine, nextTalkStep, talkQuestion, TALK_STEPS, type TalkState } from "./talk-setup";
import { LAST, STEPS } from "./setup-model";

const TRUNKS = STEPS.indexOf("Your first Trunks");
const state: TalkState = { jobs: [1, 2] };

describe("finish by talking", () => {
  it("asks the Trunk question, numbered as the setup step", () => {
    expect(TALK_STEPS).toEqual([TRUNKS]);
    const q = talkQuestion(TRUNKS, 0, state)!;
    expect(q.title).toBe("Setup · 4 of 5 · Your first Trunks");
    expect(q.question).toBe("You start with Expense Manager, Researcher. Add another?");
  });
  it("offers only Trunks not picked yet, and asks again until That's enough", () => {
    const q = talkQuestion(TRUNKS, 0, state)!;
    expect(q.options.map((o) => o.value)).toEqual(["0", "3", "4", "enough"]);
    expect(asksAgain(q, q.options[0])).toBe(true);
    expect(asksAgain(q, q.options[3])).toBe(false);
    expect(doneLine(q, q.options[3])).toBe("Done: that’s your first Trunks.");
  });
  it("ends at the health check once the Trunk question is answered", () => {
    expect(nextTalkStep(TRUNKS, () => false)).toBe(LAST);
  });
  it("asks nothing for steps the wizard now infers", () => {
    expect(talkQuestion(STEPS.indexOf("Models"), 0, state)).toBeNull();
    expect(talkQuestion(LAST, 0, state)).toBeNull();
  });
});

describe("typed answers", () => {
  const opts = talkQuestion(TRUNKS, 0, state)!.options;
  it("reads a letter or the option's words", () => {
    expect(matchAnswer("a", opts)?.value).toBe(opts[0].value);
    expect(matchAnswer(opts[1].label.toLowerCase(), opts)?.value).toBe(opts[1].value);
  });
  it("says so when it can't tell", () => {
    expect(matchAnswer("purple", opts)).toBeNull();
  });
});
