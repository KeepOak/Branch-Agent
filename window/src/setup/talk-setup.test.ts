import { describe, expect, it } from "vitest";
import { matchAnswer } from "./TalkSetup";
import { asksAgain, doneLine, nextTalkStep, talkQuestion, type TalkState } from "./talk-setup";

const state: TalkState = { look: "system", jobs: [1, 2], apps: [{ id: "telegram", label: "Telegram", connected: true }, { id: "discord", label: "Discord", connected: false }], autoUpdate: false };

describe("finish by talking", () => {
  it("asks the artifact's look question first, numbered as the wizard's step", () => {
    const q = talkQuestion(3, 0, state)!;
    expect(q.title).toBe("Setup · 4 of 11 · Make it yours");
    expect(q.options.map((o) => o.label)).toEqual(["Match this computer", "Light", "Dark"]);
    expect(doneLine(q, q.options[2])).toBe("Done: Branch looks dark.");
  });
  it("offers only Trunks not picked yet, and asks again until That's enough", () => {
    const q = talkQuestion(4, 0, state)!;
    expect(q.question).toBe("You start with Expense Manager, Researcher. Add another?");
    expect(q.options.map((o) => o.value)).toEqual(["0", "3", "4", "enough"]);
    expect(asksAgain(q, q.options[0])).toBe(true);
    expect(asksAgain(q, q.options[3])).toBe(false);
  });
  it("offers chat apps that aren't connected yet, and the phone", () => {
    expect(talkQuestion(5, 0, state)!.options.map((o) => o.value)).toEqual(["app:discord", "phone", "none"]);
  });
  it("skips steps already done and ends at the health check", () => {
    expect(nextTalkStep(3, () => false)).toBe(4);
    expect(nextTalkStep(4, (s) => s === 5)).toBe(7);
    expect(nextTalkStep(9, () => false)).toBe(10);
  });
});

describe("typed answers", () => {
  const opts = talkQuestion(3, 0, state)!.options;
  it("reads a letter or the option's words", () => {
    expect(matchAnswer("b", opts)?.value).toBe("light");
    expect(matchAnswer("make it dark please", opts)?.value).toBe("dark");
    expect(matchAnswer("just match this computer", opts)?.value).toBe("system");
  });
  it("says so when it can't tell", () => {
    expect(matchAnswer("purple", opts)).toBeNull();
  });
});
