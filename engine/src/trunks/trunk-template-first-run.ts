/**
 * The first-run contract every day-one template declares (GOD decision on board card #820), and the
 * starter pick the Chief offers during its first-run ritual. Pure data and functions.
 *
 * - firstRun.questions: two or three short answers, each with a default, so one tap accepts them all.
 * - firstRun.timezone: routines run in the owner's timezone, read from this machine and confirmable.
 * - firstRun.schedule: routines are created paused and only run after the owner says Start.
 * - firstRun.result: the Overview card for the new teammate (what it does, when it runs next, open or stop).
 *
 * Prior art: Grok Bot's bundled templates (Night Shift, Inbox Triage, Lookout ...) offered on day one,
 * and Hermes Agent profile distributions (cron jobs installed paused, setup questions with defaults).
 */

export type FirstRunQuestion = { id: string; prompt: string; default: string };

export type TrunkTemplateFirstRun = {
  questions: FirstRunQuestion[];
  /** "owner": routines use the owner's timezone, confirmed at create time. */
  timezone: "owner";
  /** "paused-until-start": routines are added turned off and turned on by trunks.template.start. */
  schedule: "paused-until-start";
  /** Text for the Overview card. The card adds the next run and Open/Stop itself. */
  result: { title: string; summary: string };
};

/** How the Chief pitches the template in one line, and the words in an owner's goal it fits. */
export type TrunkTemplateStarter = { pitch: string; fits: string[]; rank: number };

export const FIRST_RUN_MIN_QUESTIONS = 2;
export const FIRST_RUN_MAX_QUESTIONS = 3;
export const STARTER_OFFER_SIZE = 3;
const QUESTION_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_ANSWER_CHARS = 200;
const MAX_TEXT_CHARS = 300;
const ANSWER_SLOT = /\{\{answers\.([a-z][a-z0-9-]{0,31})\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TEXT_CHARS ? trimmed : undefined;
}

/** Keeps a well-formed firstRun block. Anything malformed drops the whole block with one warning. */
export function parseFirstRun(
  value: unknown,
  warnings: string[],
): TrunkTemplateFirstRun | undefined {
  if (value === undefined) {
    return undefined;
  }
  const skip = (why: string) => {
    warnings.push("The first-run setup " + why + " and was skipped.");
    return undefined;
  };
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    return skip("has no question list");
  }
  const questions: FirstRunQuestion[] = [];
  const seen = new Set<string>();
  for (const item of value.questions as unknown[]) {
    const id = isRecord(item) && typeof item.id === "string" ? item.id : "";
    const prompt = isRecord(item) ? shortText(item.prompt) : undefined;
    const fallback = isRecord(item) ? shortText(item.default) : undefined;
    if (!QUESTION_ID.test(id) || seen.has(id) || !prompt || !fallback) {
      return skip("has a question without an id, a prompt or a default");
    }
    seen.add(id);
    questions.push({ id, prompt, default: fallback });
  }
  if (questions.length < FIRST_RUN_MIN_QUESTIONS || questions.length > FIRST_RUN_MAX_QUESTIONS) {
    return skip("needs two or three questions");
  }
  if (value.timezone !== "owner" || value.schedule !== "paused-until-start") {
    return skip("must use the owner's timezone and start paused");
  }
  const title = isRecord(value.result) ? shortText(value.result.title) : undefined;
  const summary = isRecord(value.result) ? shortText(value.result.summary) : undefined;
  if (!title || !summary) {
    return skip("has no Overview card title and summary");
  }
  return {
    questions,
    timezone: "owner",
    schedule: "paused-until-start",
    result: { title, summary },
  };
}

/** Keeps a well-formed starter block, or drops it with one warning. */
export function parseStarter(value: unknown, warnings: string[]): TrunkTemplateStarter | undefined {
  if (value === undefined) {
    return undefined;
  }
  const pitch = isRecord(value) ? shortText(value.pitch) : undefined;
  const fits =
    isRecord(value) && Array.isArray(value.fits)
      ? value.fits.filter(
          (word): word is string => typeof word === "string" && /^[a-z][a-z0-9-]{1,31}$/.test(word),
        )
      : [];
  const rank =
    isRecord(value) && typeof value.rank === "number" && Number.isInteger(value.rank)
      ? value.rank
      : undefined;
  if (!pitch || rank === undefined) {
    warnings.push("The starter offer has no pitch or rank and was skipped.");
    return undefined;
  }
  return { pitch, fits: [...new Set(fits)], rank };
}

/**
 * One answer per question: the owner's text when given (trimmed, capped), otherwise the default.
 * Ids the template does not ask about are ignored.
 */
export function resolveFirstRunAnswers(
  firstRun: TrunkTemplateFirstRun,
  given: Record<string, unknown> | undefined,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of firstRun.questions) {
    const raw = given?.[question.id];
    const text =
      typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS) : "";
    answers[question.id] = text || question.default;
  }
  return answers;
}

/** Puts answers into a routine prompt's {{answers.<id>}} slots. Unknown slots become empty. */
export function fillAnswerSlots(text: string, answers: Record<string, string>): string {
  return text.replace(ANSWER_SLOT, (_slot, id: string) => answers[id] ?? "");
}

/** The answers as a short AGENTS.md section, so the new Trunk knows what the owner asked for. */
export function answersSection(
  firstRun: TrunkTemplateFirstRun,
  answers: Record<string, string>,
  timezone: string,
): string {
  const lines = firstRun.questions.map(
    (question) => "- " + question.prompt + " " + (answers[question.id] ?? question.default),
  );
  return (
    "\n## Owner's first-run answers\n\n" + lines.join("\n") + "\n- Timezone: " + timezone + "\n"
  );
}

/** True for an IANA zone this runtime can format, such as "America/New_York" or "UTC". */
export function isValidTimeZone(zone: string): boolean {
  try {
    return (
      zone.length > 0 &&
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone.length > 0
    );
  } catch {
    return false;
  }
}

/** The machine's timezone, the default the owner confirms with one tap. */
export function machineTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidTimeZone(zone) ? zone : "UTC";
}

export type StarterCandidate = { id: string; starter: TrunkTemplateStarter };

function goalWords(goal: string | undefined): Set<string> {
  return new Set(
    (goal ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1),
  );
}

/**
 * The teammates the Chief offers: always STARTER_OFFER_SIZE when the catalog has that many.
 * Templates whose fit words appear in the owner's goal come first; ties keep the catalog's rank.
 */
export function pickStarterTeammates<T extends StarterCandidate>(
  candidates: readonly T[],
  goal?: string,
  size = STARTER_OFFER_SIZE,
): T[] {
  const words = goalWords(goal);
  const score = (candidate: T) => candidate.starter.fits.filter((fit) => words.has(fit)).length;
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        a.candidate.starter.rank - b.candidate.starter.rank ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
    .slice(0, Math.max(0, size))
    .map((entry) => entry.candidate);
}
