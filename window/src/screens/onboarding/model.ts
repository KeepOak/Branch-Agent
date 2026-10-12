// R1 onboarding (HANDOFF R1-07, preview item 37): four questions, then the first conversation. This file holds the
// step list, the four modes and the rules the card follows; the engine calls live in the step components.
import { MODE_ROWS } from "../../composer/mode";
import type { Detected, TestResult } from "../../setup/setup-model";

export const STEPS = [
  { id: "welcome", name: "Welcome" },
  { id: "models", name: "Your models" },
  { id: "mode", name: "How much it may do" },
  { id: "trunk", name: "Your first Trunk" },
] as const;
export const LAST_STEP = STEPS.length - 1;

/** The four choices of step 3, in the preview's order. Full access is never offered here (owner decision 1). */
export type ModeId = "ask" | "auto" | "plan" | "read";
export type Mode = { id: ModeId; name: string; line: string; icon: "shield" | "spark" | "plan" | "eye"; recommended: boolean; exec: string | null };
const ROW_OF: Record<ModeId, string> = { ask: "Ask first", auto: "Auto", plan: "Plan first", read: "Read only" };
/** tools.exec.mode for each choice, as Settings › Permissions saves it; Plan first has no engine mode yet. */
const EXEC_OF: Record<ModeId, string | null> = { ask: "ask", auto: "auto", plan: null, read: "deny" };
export const MODES: readonly Mode[] = (["ask", "auto", "plan", "read"] as const).map((id) => {
  const row = MODE_ROWS.find((r) => r.name === ROW_OF[id]);
  return { id, name: ROW_OF[id], line: row?.line ?? "", icon: (row?.icon ?? "shield") as Mode["icon"], recommended: id === "ask", exec: EXEC_OF[id] };
});
export const PLAN_FIRST_REASON = "Plan first comes in a later update.";

/** Where Branch runs: this computer today; the other two are Coming (HANDOFF R1-07: system.info, others COMING). */
export type Where = "here" | "other" | "keepoak";
export const WHERE: readonly { id: Where; name: string; line: string; icon: "monitor" | "globe" | "cloud"; reason?: string }[] = [
  { id: "here", name: "This computer", line: "Recommended. Everything stays here.", icon: "monitor" },
  { id: "other", name: "Another computer", line: "Your Mac mini, a server or a NAS. Set up in Settings › Devices.", icon: "globe", reason: "Moving Branch to another computer comes in a later update." },
  { id: "keepoak", name: "A KeepOak computer", line: "Always on, in the cloud. Set up in Settings › Devices.", icon: "cloud", reason: "KeepOak computers come in a later update." },
];
export const whereWord = (w: Where) => (w === "here" ? "this computer" : w === "other" ? "another computer" : "a KeepOak computer");

export const EXAMPLES_REASON = "Trying Branch with examples comes in a later update.";

/** The Coming look (R1-10) for a control no engine method backs yet, so there is no method for <Coming> to check:
 *  greyed, its one-line reason as the tooltip, and a click that does nothing. */
export const unwired = (reason: string) => ({
  "aria-disabled": true as const,
  "data-coming": reason,
  title: reason,
  onClick: (e: { preventDefault(): void; stopPropagation(): void }) => { e.preventDefault(); e.stopPropagation(); },
});

export type Hello = TestResult | "busy" | null;

/** The card's own state; nothing here is saved until the step that owns it calls the engine. */
export type OnboardingState = { step: number; where: Where; off: string[]; hello: Hello; mode: ModeId };
export const clampStep = (step: number) => Math.max(0, Math.min(LAST_STEP, Math.trunc(step) || 0));
export const freshState = (step = 0): OnboardingState => ({ step: clampStep(step), where: "here", off: [], hello: null, mode: "ask" });

export const helloOk = (hello: Hello): boolean => typeof hello === "object" && hello !== null && hello.ok;

/** The primary button: its words, and whether it may be pressed (preview `primary()`). */
export function primary(s: OnboardingState): { label: string; ok: boolean; why?: string } {
  if (s.step === 0) return { label: "Get started", ok: true };
  if (s.step === 1) return helloOk(s.hello) ? { label: "Continue", ok: true } : { label: "Continue", ok: false, why: "Say hello first." };
  return { label: "Continue", ok: true };
}

/** "Claude answered in 1.4 s": the detected row's name for the model that answered, else the model ref itself. */
export function answeredBy(detected: Detected | null, modelRef: string): string {
  const row = detected?.candidates.find((c) => c.modelRef === modelRef);
  return row?.label || modelRef || "The model";
}

/** Say hello needs the model already set up, or a switched-on row that isn't signed out. */
export function canSayHello(detected: Detected | null, off: string[]): boolean {
  if (!detected) return false;
  return Boolean(detected.configuredModel) || detected.candidates.some((c) => !off.includes(c.key) && !c.signedOut);
}

export const toggle = (off: string[], key: string) => (off.includes(key) ? off.filter((k) => k !== key) : [...off, key]);
