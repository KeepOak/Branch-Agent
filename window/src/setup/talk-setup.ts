// "Finish by talking" (DESIGN-SPEC §4.8.1.12; the preview's askTalkF18 / talkApplyF18): setup's later steps asked one
// at a time as a question card above the default Trunk's message box. Each answer does what the same step of the
// wizard does; nothing here is sent to a model. Steps the window can't act on yet (Tools, the gateway) are passed
// with a line saying where they live.
import { JOBS, STEPS, type Look } from "./setup-model";
import { matchPlatformLabel } from "./steps-later";

export type TalkOption = { label: string; line?: string; value: string };
export type TalkQuestion = { key: string; step: number; part: number; title: string; question: string; options: TalkOption[] };
export type TalkState = { look: Look; jobs: number[]; apps: { id: string; label: string; connected: boolean }[]; autoUpdate: boolean };

/** The steps asked, in order: Make it yours, Your first Trunks, Reach it anywhere, Keep it running, People, Two more things. */
export const TALK_STEPS = [3, 4, 5, 7, 8, 9] as const;

const head = (step: number) => `Setup · ${step + 1} of ${STEPS.length} · ${STEPS[step]}`;

/** The question for a step and part, or null when that step has nothing left to ask. */
export function talkQuestion(step: number, part: number, s: TalkState): TalkQuestion | null {
  const q = (question: string, options: TalkOption[]): TalkQuestion => ({ key: `${step}.${part}`, step, part, title: head(step), question, options });
  switch (STEPS[step]) {
    case "Make it yours":
      return q("How should Branch look?", [
        { label: matchPlatformLabel(), line: "Follows the computer", value: "system" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ]);
    case "Your first Trunks": {
      const left = JOBS.map((j, i) => ({ label: j.name, line: j.line, value: String(i) })).filter((o) => !s.jobs.includes(Number(o.value)));
      const have = s.jobs.map((i) => JOBS[i]?.name).filter(Boolean);
      return q(have.length ? `You start with ${have.join(", ")}. Add another?` : "Which Trunk should you start with?", [
        ...left.slice(0, 3),
        { label: "That’s enough", line: have.length ? undefined : "Sapling is always here", value: "enough" },
      ]);
    }
    case "Reach it anywhere": {
      const apps = s.apps.filter((a) => !a.connected).slice(0, 2);
      return q("Where else should you reach Branch?", [
        ...apps.map((a) => ({ label: a.label, line: "Set it up now", value: `app:${a.id}` })),
        { label: "My phone", line: "Scan a code with the Branch app", value: "phone" },
        { label: "Nothing else for now", value: "none" },
      ]);
    }
    case "Keep it running":
      return q("Should Branch keep itself up to date?", [
        { label: "Yes, by itself", line: "Installs updates automatically and keeps a safety copy", value: "yes" },
        { label: "No, I’ll update it", value: "no" },
      ]);
    case "People":
      return q("Anyone else using Branch?", [
        { label: "Someone on this computer", line: "A household profile with its own PIN", value: "0" },
        { label: "A teammate on their computer", line: "An invite link or an 8-character code", value: "1" },
        { label: "Just me", value: "none" },
      ]);
    case "Two more things":
      return q("Email and calendar, or bringing back a backup?", [
        { label: "Show me the steps", line: "Opens this step of setup", value: "steps" },
        { label: "Neither for now", value: "none" },
      ]);
    default:
      return null;
  }
}

/** The "Done: …" line for an answer, in the preview's words. */
export function doneLine(q: TalkQuestion, o: TalkOption): string {
  switch (STEPS[q.step]) {
    case "Make it yours":
      return o.value === "system" ? "Done: Branch matches this computer." : `Done: Branch looks ${o.value}.`;
    case "Your first Trunks":
      return o.value === "enough" ? "Done: that’s your first Trunks." : `Done: ${o.label} is in.`;
    case "Reach it anywhere":
      return o.value === "none" ? "Done: nothing else for now. Chat apps are in Settings any time." : o.value === "phone" ? "Here’s the code card. Your phone pairs when it scans it." : `Here’s ${o.label}. It opens the same steps as Settings.`;
    case "Keep it running":
      return o.value === "yes" ? "Done: Branch keeps itself up to date." : "Done: Branch waits for you to update.";
    case "People":
      return o.value === "none" ? "Done: just you." : `Done: you’ll add ${o.value === "0" ? "someone on this computer" : "a teammate"} in Settings › People.`;
    default:
      return "Done: neither for now.";
  }
}

/** Whether the step asks again after this answer (another Trunk can be added). */
export const asksAgain = (q: TalkQuestion, o: TalkOption): boolean => STEPS[q.step] === "Your first Trunks" && o.value !== "enough";

/** The next step to ask from `after` (exclusive), skipping steps already done; LAST when none is left. */
export function nextTalkStep(after: number, done: (step: number) => boolean): number {
  const next = TALK_STEPS.find((s) => s > after && !done(s));
  return next ?? STEPS.length - 1;
}
