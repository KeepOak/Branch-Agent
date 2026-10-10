// "Finish by talking" (DESIGN-SPEC §4.8.1.12; the preview's askTalkF18 / talkApplyF18): the Trunk step asked as a
// question card above the default Trunk's message box. Each answer does what the same step of the wizard does;
// nothing here is sent to a model.
import { JOBS, STEPS } from "./setup-model";

export type TalkOption = { label: string; line?: string; value: string };
export type TalkQuestion = { key: string; step: number; part: number; title: string; question: string; options: TalkOption[] };
export type TalkState = { jobs: number[] };

/** The steps asked: only the Trunk step, the one with a choice left once the rest is inferred. */
export const TALK_STEPS = [STEPS.indexOf("Your first Trunks")] as const;

const head = (step: number) => `Setup · ${step + 1} of ${STEPS.length} · ${STEPS[step]}`;

/** The question for a step and part, or null when that step has nothing left to ask. */
export function talkQuestion(step: number, part: number, s: TalkState): TalkQuestion | null {
  const q = (question: string, options: TalkOption[]): TalkQuestion => ({ key: `${step}.${part}`, step, part, title: head(step), question, options });
  switch (STEPS[step]) {
    case "Your first Trunks": {
      const left = JOBS.map((j, i) => ({ label: j.name, line: j.line, value: String(i) })).filter((o) => !s.jobs.includes(Number(o.value)));
      const have = s.jobs.map((i) => JOBS[i]?.name).filter(Boolean);
      return q(have.length ? `You start with ${have.join(", ")}. Add another?` : "Which Trunk should you start with?", [
        ...left.slice(0, 3),
        { label: "That’s enough", line: have.length ? undefined : "Your default Trunk is always here", value: "enough" },
      ]);
    }
    default:
      return null;
  }
}

/** The "Done: …" line for an answer, in the preview's words. */
export function doneLine(_q: TalkQuestion, o: TalkOption): string {
  return o.value === "enough" ? "Done: that’s your first Trunks." : `Done: ${o.label} is in.`;
}

/** Whether the step asks again after this answer (another Trunk can be added). */
export const asksAgain = (_q: TalkQuestion, o: TalkOption): boolean => o.value !== "enough";

/** The next step to ask from `after` (exclusive), skipping steps already done; LAST when none is left. */
export function nextTalkStep(after: number, done: (step: number) => boolean): number {
  const next = TALK_STEPS.find((s) => s > after && !done(s));
  return next ?? STEPS.length - 1;
}
