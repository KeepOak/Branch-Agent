import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockQuestion, QuestionLine } from "./QuestionCard";
import { anchorQuestions, answerValues, outcome, parseRecord, pick, type, type QuestionRecord } from "./questions";

const raw = (patch: Record<string, unknown> = {}) => ({
  id: "q1", sessionKey: "agent:main:x", createdAtMs: 500, expiresAtMs: 9e12, status: "pending",
  questions: [{ questionId: "format", header: "Format", question: "Which format?", options: [{ label: "Brief", description: "One page" }, { label: "Report" }], isOther: true }],
  ...patch,
});
const record = (patch: Record<string, unknown> = {}) => parseRecord(raw(patch)) as QuestionRecord;

describe("questions", () => {
  it("reads a question record and refuses a malformed one, as the control UI's parser does", () => {
    const r = record();
    expect(r.questions[0]).toMatchObject({ questionId: "format", isOther: true, multiSelect: false, isSecret: false });
    expect(parseRecord(raw({ questions: [{ questionId: "Bad id", header: "", question: "x", options: [] }] }))).toBeNull();
    expect(parseRecord(raw({ questions: [{ questionId: "a", header: "", question: "x", options: [{}, {}, {}, {}, {}] }] }))).toBeNull();
    expect(parseRecord(raw({ status: "answered", answers: { answers: { format: ["Brief"] } } }))?.answers).toEqual({ format: ["Brief"] });
  });

  it("sends the picked labels, then the typed answer; typing a single answer drops the pick", () => {
    const q = record().questions[0];
    const picked = pick(q, undefined, "Brief");
    expect(answerValues(q, picked)).toEqual(["Brief"]);
    expect(answerValues(q, type(q, picked, "  my own  "))).toEqual(["my own"]);
    const multi = { ...q, multiSelect: true };
    const both = pick(multi, pick(multi, undefined, "Brief"), "Report");
    expect(answerValues(multi, both)).toEqual(["Brief", "Report"]);
    expect(answerValues(multi, pick(multi, both, "Brief"))).toEqual(["Report"]);
    expect(answerValues({ ...q, isSecret: true }, { selected: [], text: " k3y " })).toEqual([" k3y "]);
  });

  it("words a question that is over", () => {
    expect(outcome(record({ status: "answered", answers: { answers: { format: ["Brief", "Report"] } } }))).toEqual({ pill: "ok", words: "Answered", answer: "Brief, Report" });
    expect(outcome(record({ status: "cancelled" })).words).toBe("Skipped");
    expect(outcome(record({ status: "expired" })).pill).toBe("bad");
  });

  it("puts an answered question after the turn it was asked in, and a waiting one at the end", () => {
    const history = [
      { kind: "user", meta: { timestamp: 100 } }, { kind: "text" }, { kind: "done" },
      { kind: "user", meta: { timestamp: 900 } }, { kind: "text" },
    ];
    const done = record({ status: "answered", answers: { answers: { format: ["Brief"] } } });
    const waiting = record({ id: "q2", createdAtMs: 950 });
    const at = anchorQuestions(history, [done, waiting]);
    expect(at.get(2)?.map((r) => r.id)).toEqual(["q1"]);
    expect(at.get(-1)?.map((r) => r.id)).toEqual(["q2"]);
  });
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("the question card", () => {
  it("answers with the picked option's label through question.resolve", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<DockQuestion record={record()} trunkName="Research" onResolve={resolve} />));
    expect(host.textContent).toContain("Which format?");
    await act(async () => host.querySelector<HTMLButtonElement>(".opt")!.click());
    expect(resolve).toHaveBeenCalledWith("q1", { answers: { format: ["Brief"] } });
  });

  it("takes B from the keyboard and collapses to one line", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<DockQuestion record={record()} trunkName="Research" onResolve={resolve} />));
    await act(async () => host.querySelector(".card")!.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true })));
    expect(resolve).toHaveBeenCalledWith("q1", { answers: { format: ["Report"] } });
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Collapse question']")!.click());
    expect(host.querySelector(".dock-q.col .dock-q-t")?.textContent).toBe("Which format?");
    expect(host.querySelector(".card")?.parentElement?.hidden).toBe(true);
  });

  it("steps through several questions with Back, Skip and Submit", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const two = record({ questions: [raw().questions[0], { questionId: "when", header: "When", question: "When is it due?", options: [{ label: "Today" }, { label: "Friday" }] }] });
    await act(async () => root.render(<DockQuestion record={two} trunkName="Research" onResolve={resolve} />));
    expect(host.textContent).toContain("Question 1 of 2");
    await act(async () => host.querySelector<HTMLButtonElement>(".opt")!.click());
    expect(host.textContent).toContain("Question 2 of 2");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".opt")][1].click());
    expect(resolve).toHaveBeenCalledWith("q1", { answers: { format: ["Brief"], when: ["Friday"] } });
  });

  it("preserves picks and the current step while the dock is collapsed", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const two = record({ questions: [raw().questions[0], { questionId: "when", header: "When", question: "When is it due?", options: [{ label: "Today" }] }] });
    await act(async () => root.render(<DockQuestion record={two} trunkName="Research" onResolve={resolve} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".opt")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Collapse question']")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Expand question']")!.click());
    expect(host.querySelector(".q-step")?.textContent).toBe("Question 2 of 2");
    await act(async () => host.querySelector<HTMLButtonElement>(".opt")!.click());
    expect(resolve).toHaveBeenCalledWith("q1", { answers: { format: ["Brief"], when: ["Today"] } });
  });

  it("submits only once while a request is pending and allows retry after failure", async () => {
    let reject: (error: Error) => void = () => {};
    const resolve = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    await act(async () => root.render(<DockQuestion record={record()} trunkName="Research" onResolve={resolve} />));
    const card = host.querySelector(".card")!;
    await act(async () => {
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      card.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Connection lost")));
    expect(host.querySelector("[role='alert']")?.textContent).toBe("Connection lost");
    await act(async () => card.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true })));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith("q1", { answers: { format: ["Report"] } });
  });

  it("does not advance multiple questions on a held shortcut key", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const two = record({ questions: [raw().questions[0], { questionId: "when", header: "When", question: "When is it due?", options: [{ label: "Today" }] }] });
    await act(async () => root.render(<DockQuestion record={two} trunkName="Research" onResolve={resolve} />));
    await act(async () => host.querySelector(".card")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    await act(async () => host.querySelector(".card")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true })));
    expect(resolve).not.toHaveBeenCalled();
    expect(host.querySelector(".q-step")?.textContent).toBe("Question 2 of 2");
  });

  it("reveals a secret only on request and masks a new question", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const secret = record({ questions: [{ questionId: "key", header: "Key", question: "API key?", options: [], isSecret: true }] });
    await act(async () => root.render(<DockQuestion record={secret} trunkName="Research" onResolve={resolve} />));
    expect(host.querySelector("input")?.type).toBe("password");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Show']")!.click());
    expect(host.querySelector("input")?.type).toBe("text");
    expect(resolve).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Hide']")!.click());
    expect(host.querySelector("input")?.type).toBe("password");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Show']")!.click());
    await act(async () => root.render(<DockQuestion record={{ ...secret, id: "q2" }} trunkName="Research" onResolve={resolve} />));
    expect(host.querySelector("input")?.type).toBe("password");
  });

  it("draws the decided line once the question is over", async () => {
    await act(async () => root.render(<QuestionLine record={record({ status: "answered", answers: { answers: { format: ["Brief"] } } })} />));
    expect(host.textContent).toBe("AnsweredWhich format? · Brief");
  });
});

describe("the plan card's place", () => {
  it("goes after the turn whose steps last updated it, or at the end", async () => {
    const { planAnchor } = await import("./PlanCard");
    const h = [{ kind: "user" }, { kind: "step", tool: "progress_card" }, { kind: "text" }, { kind: "done" }, { kind: "user" }, { kind: "text" }];
    expect(planAnchor(h)).toBe(3);
    expect(planAnchor(h.slice(0, 4))).toBe(-1);
    expect(planAnchor([{ kind: "user" }, { kind: "text" }])).toBe(-1);
  });
});
