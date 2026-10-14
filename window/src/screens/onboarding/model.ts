// R1 onboarding (HANDOFF R1-07, preview item 37): four questions, then the first conversation. This file holds the
// step list, the four modes and the rules the card follows; the engine calls live in the step components.
import { MODE_ROWS } from "../../composer/mode";
import type { Detected, TestResult } from "../../setup/setup-model";
import { DAY_ONE_TEMPLATES, listedTemplate, type DayOneTemplate, type ListedTemplate } from "../seedbank/templates";

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

/** Where Branch runs: this computer. Another computer and a KeepOak computer wait in Seedbank › Coming to Branch until
 *  the engine can move Branch there (R1-15). */
export type Where = "here" | "other" | "keepoak";
export const WHERE: readonly { id: Where; name: string; line: string; icon: "monitor" | "globe" | "cloud"; reason?: string }[] = [
  { id: "here", name: "This computer", line: "Recommended. Everything stays here.", icon: "monitor" },
];
export const whereWord = (w: Where) => (w === "here" ? "this computer" : w === "other" ? "another computer" : "a KeepOak computer");

export const EXAMPLES_REASON = "This engine can’t show example Trunks.";

/** An example Trunk from trunks.template.starters: its name and the line it introduces itself with. */
export type Example = { id: string; name: string; pitch: string };
export function readExamples(value: unknown): Example[] {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const offer = Array.isArray(v.offer) ? (v.offer as unknown[]) : [];
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  return offer.flatMap((o) => {
    const r = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
    const id = str(r.id), name = str(r.name);
    return id && name ? [{ id, name, pitch: str(r.pitch) || str(r.description) }] : [];
  });
}

/** The engine call each control the card doesn't wire yet waits for (R1-10). They render through <Coming unwired>
 *  (Unwired.tsx), so the dev list names the method. */
export const WAITS_FOR = {
  /** Example Trunks, with no account: the starter teammates the engine carries. */
  examples: "trunks.template.starters",
  /** A day-one template this engine doesn't carry yet. */
  template: "trunks.template.create",
  /** Plan first has no tools.exec.mode value yet (HANDOFF R1-04: COMING). */
  planFirst: "config.patch",
  /** The same questions in a conversation named "Setting up Branch" (sessions.create with its first message). */
  talk: "sessions.create",
} as const;

export type Hello = TestResult | "busy" | null;

/** The card's own state; nothing here is saved until the step that owns it calls the engine. */
export type OnboardingState = {
  step: number; where: Where; off: string[]; hello: Hello; mode: ModeId;
  /** Step 4: what the person typed, the suggested Trunks they picked, and the template chips they picked (template ids). */
  text: string; pick: string[]; tpl: string[];
  /** Step 2: the person chose Try it with examples, which lets Continue go on without a hello. */
  examples: boolean;
};
export const clampStep = (step: number) => Math.max(0, Math.min(LAST_STEP, Math.trunc(step) || 0));
export const freshState = (step = 0): OnboardingState => ({ step: clampStep(step), where: "here", off: [], hello: null, mode: "ask", text: "", pick: [], tpl: [], examples: false });

export const helloOk = (hello: Hello): boolean => typeof hello === "object" && hello !== null && hello.ok;

/** The primary button: its words, and whether it may be pressed (preview `primary()`). */
export function primary(s: OnboardingState, defaultName = ""): { label: string; ok: boolean; why?: string } {
  if (s.step === 0) return { label: "Get started", ok: true };
  if (s.step === 1) return helloOk(s.hello) || s.examples ? { label: "Continue", ok: true } : { label: "Continue", ok: false, why: "Say hello first." };
  if (s.step === LAST_STEP) return picked(s).length ? { label: "Meet them", ok: true } : { label: `Start with ${defaultName || "your default Trunk"}`, ok: true };
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

/* ---------- Step 4, Your first Trunk (preview item 37 `JOBS`, `suggest`, `obPickP37`) ---------- */

/** What each day-one template takes off your plate, and the words that suggest it (the preview's JOBS, keyed by id). */
const JOBS: readonly { id: string; re: RegExp; why: string }[] = [
  { id: "trunk-doctor", re: /new trunk|build (a |an |my )?(trunk|agent|team)|my team|check ?up|which trunks|set (it|them) up|assistants?|helpers?/i, why: "builds Trunks for you from a short interview, then checks on your team every week" },
  { id: "mentions-watch", re: /mention|brand|reputation|social|press|news about|what people say|monitor/i, why: "watches the web for mentions of you and sends a quiet weekday digest" },
  { id: "home-desk", re: /home|family|kids?|school|household|chores?|errands?|appointments?|morning|my partner|pick ?up/i, why: "keeps family and home admin moving on your email and calendar" },
  { id: "project-lead", re: /projects?|deadlines?|launch|roadmap|milestones?|tasks?|coordinat|organi[sz]|plan/i, why: "runs your projects as topics and hands each task to the right Trunk" },
  { id: "prospect-finder", re: /sales|leads?|prospects?|clients?|customers?|outreach|pipeline|b2b|sell/i, why: "finds well-fitting prospects and drafts first messages for you to approve" },
  { id: "search-brief-desk", re: /seo|content|blog|keywords?|articles?|writers?|marketing|google|posts?|newsletter/i, why: "turns keywords into content ideas and briefs a writer can use" },
  { id: "spend-saver", re: /money|sav(e|ing)|subscriptions?|bills?|expenses?|budget|costs?|cheaper|spend|invoices?|receipts?/i, why: "finds savings in your subscriptions and bills and drafts the counteroffers" },
  { id: "hiring-desk", re: /hir(e|ing)|recruit|interviews?|candidates?|job opening|onboard/i, why: "schedules interview loops, preps interviewers and chases feedback" },
];

export type Suggestion = { template: DayOneTemplate; why: string };

/** One to three day-one templates for what the person typed, in the templates' order; none for an empty box. */
export function suggest(text: string): Suggestion[] {
  const t = String(text || "");
  return JOBS.filter((j) => j.re.test(t)).slice(0, 3).flatMap((j) => {
    const template = DAY_ONE_TEMPLATES.find((d) => d.id === j.id);
    return template ? [{ template, why: j.why }] : [];
  });
}

/** The line under the suggestions when there are none. */
export const suggestHint = (text: string) => (text.trim() ? "Say a little more, or pick a template." : "Type a sentence and Branch suggests 1–3 Trunks.");

/** The picked template ids, suggestions first, without repeats: the order the Trunks are created in. */
export const picked = (s: Pick<OnboardingState, "pick" | "tpl">): string[] => [...new Set([...s.pick, ...s.tpl])];

/** Tapping a suggestion or a chip: on if it was off, off if it was on. A pick that is also suggested counts as a suggestion. */
export function togglePick(s: Pick<OnboardingState, "text" | "pick" | "tpl">, id: string): Pick<OnboardingState, "pick" | "tpl"> {
  const on = s.pick.includes(id) || s.tpl.includes(id);
  const pick = s.pick.filter((x) => x !== id), tpl = s.tpl.filter((x) => x !== id);
  if (!on) (suggest(s.text).some((x) => x.template.id === id) ? pick : tpl).push(id);
  return { pick, tpl };
}

/** The engine's copy of a day-one template, or the reason it can't be made here yet (Coming). */
export function carried(template: DayOneTemplate, listed: readonly ListedTemplate[] | null): { id: string } | { reason: string } {
  const hit = listed ? listedTemplate(template, listed) : undefined;
  return hit ? { id: hit.id } : { reason: `${template.name} arrives in a later update.` };
}

/** The person's own timezone for the new Trunks' routines (the #1304 first-run contract: owner timezone, paused until Start). */
export function ownerTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

/** A Trunk's main conversation key, as agents.list names it (`agent:<id>:<mainKey>`). */
export const mainSessionOf = (agentId: string, mainKey = "main") => `agent:${agentId}:${mainKey || "main"}`;

/** The first message in the new Trunk's main conversation (HANDOFF R1-07 First greeting: chat.send). */
export const GREETING = "Hi! I just set you up. Say hello in a sentence, then ask what to call me and what I’m working on right now.";
