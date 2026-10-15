// R1-05 Approvals and Ask first (HANDOFF R1-05; preview askCard, cAskP17, lockBanner). One shape for everything that
// waits for a yes: an exec approval, a plugin's action (send, spend, delete, sign in) and an operator question. Each is
// read from the engine's own events and lists, and answered with the call its kind needs. The wording reuses the
// Classic card's helpers (thread/ApprovalCard actionWords / actionFields, thread/approval-trust maskCommand).
import { actionFields, actionWords } from "../../thread/ApprovalCard";
import { maskCommand } from "../../thread/approval-trust";
import type { ApprovalDecision } from "../../thread/model";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const EVERY: ApprovalDecision[] = ["allow-once", "allow-always", "deny"];

export type AskKind = "exec" | "plugin" | "question";
export type AskOption = { label: string; value: string };
export type AskQuestion = { questionId: string; header: string; question: string; options: AskOption[]; multi: boolean; free: boolean; secret: boolean };
/** The #728 safety layer's seam: exec.approval.resolve and plugin.approval.resolve take an optional reviewer. */
export type AskReviewer = { channel: string; accountId: string; senderId: string };
export type Ask = {
  id: string;
  kind: AskKind;
  /** The question, e.g. "Send this email to Dana Okafor?" */
  title: string;
  /** Key/value lines (To, Subject, Computer, Folder). */
  facts: [string, string][];
  body: string;
  /** An exec approval's command, secrets shown as dots. */
  code?: string;
  /** Only these answers are offered; deny is always there. */
  allowed: ApprovalDecision[];
  expiresAtMs?: number;
  sessionKey?: string;
  agentId?: string;
  warning?: boolean;
  words: { yes: string; no: string; done: string; refused: string };
  questions: AskQuestion[];
  reviewer?: AskReviewer;
};

/** An answer: a decision for an approval, the chosen answers for a question, or "skip" to cancel a question. */
export type Reply = ApprovalDecision | { answers: Record<string, string[]> } | "skip";

const decisionsOf = (v: unknown): ApprovalDecision[] => {
  const list = Array.isArray(v) ? v.filter((d): d is ApprovalDecision => EVERY.includes(d as ApprovalDecision)) : [];
  if (!list.length) return [...EVERY];
  return list.includes("deny") ? list : [...list, "deny"];
};
const expiry = (p: Record<string, unknown>) => (typeof p.expiresAtMs === "number" ? { expiresAtMs: p.expiresAtMs } : {});
const where = (sessionKey: string, agentId: string) => ({ ...(sessionKey ? { sessionKey } : {}), ...(agentId ? { agentId } : {}) });

function readExec(p: Record<string, unknown>): Ask | null {
  const r = rec(p.request), pres = rec(p.presentation), id = str(p.id);
  if (!id) return null;
  const command = str(r.command) || str(pres.commandText) || str(r.title);
  const host = str(r.host) || str(pres.host);
  return {
    id, kind: "exec", title: "Run this command?",
    facts: [["Computer", !host || host === "gateway" ? "This computer" : host], ["Folder", str(r.cwd) || "Its workspace"]],
    body: str(pres.warningText), code: maskCommand(command),
    allowed: decisionsOf(r.allowedDecisions ?? pres.allowedDecisions), ...expiry(p),
    ...where(str(r.sessionKey), str(r.agentId) || str(pres.agentId)),
    words: actionWords("Run"), questions: [],
  };
}

function readPlugin(p: Record<string, unknown>): Ask | null {
  const r = { ...rec(p.presentation), ...rec(p.request) }, id = str(p.id);
  if (!id) return null;
  const title = str(r.title) || "A plugin needs your OK";
  const { fields, body } = actionFields(str(r.description));
  return {
    id, kind: "plugin", title, facts: fields, body: [body, str(r.detail)].filter(Boolean).join("\n\n"),
    allowed: decisionsOf(r.allowedDecisions), ...expiry(p), ...where(str(r.sessionKey), str(r.agentId)),
    ...(r.severity === "warning" || r.severity === "critical" ? { warning: true } : {}),
    words: actionWords(title), questions: [],
  };
}

function readQuestion(p: Record<string, unknown>): Ask | null {
  const id = str(p.id);
  if (!id || (p.status !== undefined && p.status !== "pending")) return null;
  const questions: AskQuestion[] = (Array.isArray(p.questions) ? p.questions : []).map(rec).filter((q) => str(q.questionId) && str(q.question)).map((q) => {
    const options = (Array.isArray(q.options) ? q.options : []).map(rec).filter((o) => str(o.label)).map((o) => ({ label: str(o.label), value: str(o.value) || str(o.label) }));
    return { questionId: str(q.questionId), header: str(q.header), question: str(q.question), options, multi: q.multiSelect === true, free: !options.length || q.isOther === true, secret: q.isSecret === true };
  });
  if (!questions.length) return null;
  return {
    id, kind: "question", title: questions[0].question, facts: [], body: "", allowed: [], ...expiry(p),
    ...where(str(p.sessionKey), str(p.agentId)),
    words: { yes: "Reply", no: "Skip", done: "Answered", refused: "Skipped" }, questions,
  };
}

/** Reads one `*.requested` event payload or list item. */
export function readAsk(kind: AskKind, payload: unknown): Ask | null {
  const p = rec(payload);
  return kind === "exec" ? readExec(p) : kind === "plugin" ? readPlugin(p) : readQuestion(p);
}

/** The items of a list answer: exec and plugin lists give an array or {items | approvals}; question.list gives {questions}. */
export function listItems(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const r = rec(result), items = r.items ?? r.approvals ?? r.questions;
  return Array.isArray(items) ? items : [];
}

export const KINDS: readonly AskKind[] = ["exec", "plugin", "question"];
export const LIST_OF: Record<AskKind, string> = { exec: "exec.approval.list", plugin: "plugin.approval.list", question: "question.list" };
export const RESOLVE_OF: Record<AskKind, string> = { exec: "exec.approval.resolve", plugin: "plugin.approval.resolve", question: "question.resolve" };

/** The engine call for an answer, or null when the request doesn't allow it. */
export function callFor(ask: Ask, reply: Reply): { method: string; params: Record<string, unknown> } | null {
  const method = RESOLVE_OF[ask.kind];
  if (ask.kind === "question") {
    if (reply === "skip") return { method, params: { id: ask.id, cancel: true } };
    return typeof reply === "object" ? { method, params: { id: ask.id, answers: { answers: reply.answers } } } : null;
  }
  if (typeof reply !== "string" || reply === "skip" || !ask.allowed.includes(reply)) return null;
  return { method, params: { id: ask.id, decision: reply, ...(ask.reviewer ? { reviewer: ask.reviewer } : {}) } };
}

export type Settled = ApprovalDecision | "answered" | "skipped" | "elsewhere" | "expired";
export const settledBy = (reply: Reply): Settled => (reply === "skip" ? "skipped" : typeof reply === "object" ? "answered" : reply);

/** The decided pill: "✓ Sent", "✕ Declined", "Answered elsewhere". */
export function settledText(ask: Ask, how: Settled, name: string): { text: string; tone: "ok" | "bad" | "idle" } {
  if (how === "allow-once") return { text: `✓ ${ask.words.done}`, tone: "ok" };
  if (how === "allow-always") return { text: `✓ ${ask.words.done} · ${name} may now do this without asking`, tone: "ok" };
  if (how === "deny") return { text: "✕ Declined", tone: "bad" };
  if (how === "answered") return { text: "✓ Answered", tone: "ok" };
  if (how === "skipped") return { text: "✕ Skipped", tone: "bad" };
  if (how === "expired") return { text: "Expired · not allowed", tone: "idle" };
  return { text: "Answered elsewhere", tone: "idle" };
}

/** How a `*.resolved` event we didn't cause ended the request. */
export function settledFromEvent(kind: AskKind, payload: unknown): Settled {
  const p = rec(payload);
  if (kind === "question") return p.status === "expired" ? "expired" : "elsewhere";
  return p.decision === "expired" || p.reason === "timeout" ? "expired" : "elsewhere";
}
