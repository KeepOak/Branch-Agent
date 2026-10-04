// Questions a Trunk asks (DESIGN-SPEC §4.2.2 "Questions"): the engine's question.list / question.resolve and its
// question.requested / question.resolved events, read the way OpenClaw's control UI reads them
// (ui/src/app/question-prompt.ts, question-prompt-parse.ts; pages/chat/components/chat-question-card.ts).
// An answer is the picked option labels, then the typed answer; skipping is { cancel: true }.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";

export type QuestionOption = { label: string; description?: string };
export type Question = {
  questionId: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
  isOther: boolean;
  isSecret: boolean;
  url?: string;
  secretStore?: { name: string; kind: string; allowedHosts: string[] };
};
export type QuestionStatus = "pending" | "answered" | "cancelled" | "expired";
export type QuestionRecord = {
  id: string;
  questions: Question[];
  sessionKey?: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: QuestionStatus;
  answers?: Record<string, string[]>;
};
/** What the person has picked or typed for one question. */
export type Draft = { selected: string[]; text: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const STATUSES: QuestionStatus[] = ["pending", "answered", "cancelled", "expired"];

export function parseQuestion(raw: unknown): Question | null {
  const v = rec(raw);
  const questionId = str(v.questionId);
  const question = str(v.question).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(questionId) || !question || !Array.isArray(v.options) || v.options.length > 4) return null;
  const options = v.options.map(rec).filter((o) => str(o.label)).map((o) => ({ label: str(o.label), ...(typeof o.description === "string" ? { description: o.description } : {}) }));
  if (options.length !== v.options.length) return null;
  const url = str(v.url);
  const store = rec(v.secretStore);
  return {
    questionId,
    header: str(v.header),
    question,
    options,
    multiSelect: v.multiSelect === true,
    isOther: v.isOther === true,
    isSecret: v.isSecret === true || Boolean(store.name),
    ...(/^https?:\/\//i.test(url) ? { url } : {}),
    ...(store.name ? { secretStore: { name: str(store.name), kind: str(store.kind), allowedHosts: Array.isArray(store.allowedHosts) ? store.allowedHosts.map(str).filter(Boolean) : [] } } : {}),
  };
}

function parseAnswers(raw: unknown): Record<string, string[]> | undefined {
  const envelope = rec(raw).answers;
  const nested = rec(envelope).answers;
  const a = rec(nested && typeof nested === "object" && !Array.isArray(nested) ? nested : envelope);
  const out: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(a)) if (Array.isArray(list)) out[id] = list.map(str);
  return Object.keys(out).length ? out : undefined;
}

export function parseRecord(raw: unknown): QuestionRecord | null {
  const r = rec(raw);
  const questions = (Array.isArray(r.questions) ? r.questions : []).map(parseQuestion);
  if (!str(r.id) || !questions.length || questions.some((q) => !q)) return null;
  const status = STATUSES.find((s) => s === r.status) ?? "pending";
  return {
    id: str(r.id),
    questions: questions as Question[],
    ...(str(r.sessionKey) ? { sessionKey: str(r.sessionKey) } : {}),
    createdAtMs: Number(r.createdAtMs) || 0,
    expiresAtMs: Number(r.expiresAtMs) || 0,
    status,
    ...(status === "answered" && parseAnswers(r.answers) ? { answers: parseAnswers(r.answers) } : {}),
  };
}

/** Whether the person may free-type an answer: when there are no options, or the question allows "other". */
export const typesOwn = (q: Question) => q.options.length === 0 || q.isOther || q.isSecret;

/** The values sent for one question: the picked labels, then the typed answer (a secret is sent untrimmed). */
export function answerValues(q: Question, d: Draft | undefined): string[] {
  const text = q.isSecret ? d?.text ?? "" : (d?.text ?? "").trim();
  return [...(d?.selected ?? []), ...(text ? [text] : [])];
}

/** Picks an option: one at a time, or toggled in a pick-several question. Picking clears a typed single answer. */
export function pick(q: Question, d: Draft | undefined, label: string): Draft {
  const selected = d?.selected ?? [];
  if (q.multiSelect) return { selected: selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label], text: d?.text ?? "" };
  return { selected: [label], text: "" };
}

/** Typing a single answer drops the picked option, as OpenClaw's card does. */
export function type(q: Question, d: Draft | undefined, text: string): Draft {
  return { selected: !q.multiSelect && text.trim() ? [] : d?.selected ?? [], text };
}

/** "Answered" with what was said, "Skipped" or "Expired": the decided line for a question that is over. */
export function outcome(r: QuestionRecord): { pill: "ok" | "idle" | "bad"; words: string; answer: string } {
  if (r.status === "cancelled") return { pill: "idle", words: "Skipped", answer: "" };
  if (r.status === "expired") return { pill: "bad", words: "Expired", answer: "" };
  const secret = r.questions.some((q) => q.isSecret);
  const answer = secret ? "" : r.questions.map((q) => r.answers?.[q.questionId]?.join(", ") ?? "").filter(Boolean).join(" · ");
  return { pill: "ok", words: secret ? "Saved" : "Answered", answer };
}

/** The open conversation's questions, kept current from question.list and the question events. */
export function useQuestions(engine: WindowEngine | undefined) {
  const [list, setList] = useState<QuestionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = engine?.sessionKey ?? null;
  useEffect(() => {
    setList([]);
    setError(null);
    if (!engine || !key) return;
    let active = true;
    const resolved = new Map<string, { status: QuestionStatus; answers?: Record<string, string[]> }>();
    const mine = (r: QuestionRecord | null): r is QuestionRecord => Boolean(r && r.sessionKey === key);
    const upsert = (r: QuestionRecord) => setList((cur) => [...cur.filter((x) => x.id !== r.id), r].sort((a, b) => a.createdAtMs - b.createdAtMs));
    engine.request("question.list", {}).then(
      (res) => {
        if (!active) return;
        const snapshot = (Array.isArray(rec(res).questions) ? (rec(res).questions as unknown[]) : []).map(parseRecord).filter(mine);
        setList((cur) => [...new Map([...snapshot, ...cur].map((r) => [r.id, { ...r, ...resolved.get(r.id) }])).values()].sort((a, b) => a.createdAtMs - b.createdAtMs));
      },
      (e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); },
    );
    const unsubscribe = engine.onEvent((e) => {
      if (e.event === "question.requested") {
        const r = parseRecord(e.payload);
        if (mine(r)) upsert(r);
      } else if (e.event === "question.resolved") {
        const p = rec(e.payload);
        const status = STATUSES.find((s) => s === p.status);
        if (!status) return;
        resolved.set(str(p.id), { status, ...(status === "answered" ? { answers: parseAnswers(p) } : {}) });
        setList((cur) => cur.map((x) => (x.id === str(p.id) ? { ...x, status, ...(status === "answered" ? { answers: parseAnswers(p) } : {}) } : x)));
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [engine, key]);
  const resolve = useCallback(
    async (id: string, resolution: { answers: Record<string, string[]> } | { cancel: true }) => {
      if (!engine) throw new Error("Not connected to the engine yet.");
      const res = rec(await engine.request("question.resolve", { id, ...resolution }));
      const status = STATUSES.find((s) => s === res.status) ?? ("answers" in resolution ? "answered" : "cancelled");
      setList((cur) => cur.map((x) => (x.id === id ? { ...x, status, ...("answers" in resolution ? { answers: parseAnswers(res) ?? resolution.answers } : {}) } : x)));
    },
    [engine],
  );
  return { list: list.filter((r) => r.sessionKey === key), error, resolve };
}

/** Where each question goes in the thread: after the turn it was asked in (the last turn whose message was sent
 *  before it). A waiting question, or one asked during the run going now, goes at the end (key -1). */
export function anchorQuestions(history: readonly { kind: string; meta?: { timestamp?: number } }[], records: readonly QuestionRecord[]): Map<number, QuestionRecord[]> {
  const out = new Map<number, QuestionRecord[]>();
  const add = (at: number, r: QuestionRecord) => out.set(at, [...(out.get(at) ?? []), r]);
  for (const r of records) {
    let user = -1;
    history.forEach((b, i) => {
      if (b.kind === "user" && (b.meta?.timestamp ?? Infinity) <= r.createdAtMs) user = i;
    });
    let end = user;
    while (end >= 0 && end + 1 < history.length && history[end + 1].kind !== "user") end += 1;
    add(r.status === "pending" || user < 0 || end === history.length - 1 ? -1 : end, r);
  }
  return out;
}
