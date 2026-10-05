// The thread's message actions, each through the engine method its DESIGN-SPEC row names
// (copied from engine/ui/src: lib/sessions/session-scoped-operations.ts, pages/chat/chat-history-actions.ts,
// pages/chat/chat-pane-reactions.ts).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../connect/engine";
import type { ApprovalDecision, Block } from "./model";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

type Key = { sessionKey: string; agentId?: string };

function target(engine: WindowEngine): Key {
  if (!engine.sessionKey) {
    throw new Error("No conversation is open.");
  }
  return { sessionKey: engine.sessionKey, ...(engine.agentId ? { agentId: engine.agentId } : {}) };
}

/** Goes back to just before one of your messages (`sessions.rewind`); returns that message's words. */
export async function rewindTo(engine: WindowEngine, entryId: string): Promise<string> {
  const result = rec(await engine.request("sessions.rewind", { ...target(engine), entryId }));
  return str(result.editorText);
}

/** Sends words in the open conversation (`chat.send`), the way the composer does. */
export async function sendText(engine: WindowEngine, message: string): Promise<string> {
  const result = rec(await engine.request("chat.send", { ...target(engine), message, idempotencyKey: crypto.randomUUID() }));
  return str(result.runId);
}

/** "Try again" on a reply: go back to just before the message it answered, then ask again with the same words. */
export async function askAgain(engine: WindowEngine, userEntryId: string): Promise<void> {
  const words = await rewindTo(engine, userEntryId);
  if (!words.trim()) {
    throw new Error("The engine did not give back the words to send again.");
  }
  await sendText(engine, words);
}

/** "Edit and send again": go back to just before your message, then send the edited words. */
export async function editAndSend(engine: WindowEngine, userEntryId: string, words: string): Promise<void> {
  await rewindTo(engine, userEntryId);
  await sendText(engine, words);
}

/** "Branch from here" (`sessions.fork`, then `sessions.patch` for its name and model). Returns the new conversation. */
export async function branchFrom(
  engine: WindowEngine,
  entryId: string,
  options: { label?: string; model?: string },
): Promise<{ sessionKey: string; editorText: string }> {
  const result = rec(await engine.request("sessions.fork", { ...target(engine), entryId }));
  const sessionKey = str(result.sessionKey);
  const patch = {
    ...(options.label?.trim() ? { label: options.label.trim() } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
  if (sessionKey && Object.keys(patch).length) {
    await engine.request("sessions.patch", { key: sessionKey, ...patch });
  }
  return { sessionKey, editorText: str(result.editorText) };
}

export type Reaction = { emoji: string; count: number; mine: boolean; names: string[] };

/** Reads `session.reactions.list` (or a set result) into chips per message id. */
export function readReactions(raw: unknown, selfId: string | null): Map<string, Reaction[]> {
  const out = new Map<string, Reaction[]>();
  for (const [messageId, list] of Object.entries(rec(raw))) {
    out.set(messageId, toChips(list, selfId));
  }
  return out;
}

export function toChips(list: unknown, selfId: string | null): Reaction[] {
  return (Array.isArray(list) ? list : []).map((r) => {
    const ids = (Array.isArray(rec(r).identities) ? (rec(r).identities as unknown[]) : []).map(rec);
    return {
      emoji: str(rec(r).emoji),
      count: Number(rec(r).count) || ids.length,
      mine: selfId !== null && ids.some((i) => str(i.id) === selfId),
      names: ids.map((i) => str(i.label) || str(i.id)),
    };
  });
}

export async function listReactions(engine: WindowEngine): Promise<unknown> {
  return rec(await engine.request("session.reactions.list", target(engine))).reactions;
}

/** Adds or removes your reaction (`session.reactions.set`); returns the message's reactions as the engine holds them. */
export async function setReaction(engine: WindowEngine, messageId: string, emoji: string, remove: boolean): Promise<unknown> {
  const result = rec(await engine.request("session.reactions.set", { ...target(engine), messageId, emoji, ...(remove ? { remove: true } : {}) }));
  return result.reactions;
}

/** Answers an approval (`exec.approval.resolve`, or `plugin.approval.resolve` for a plugin's request). */
export async function resolveApproval(engine: WindowEngine, id: string, decision: ApprovalDecision, plugin = false): Promise<void> {
  await engine.request(plugin ? "plugin.approval.resolve" : "exec.approval.resolve", { id, decision });
}

/** The user message a reply answers: the nearest earlier user block that has an entry id. */
export function askedBy(blocks: readonly Block[], index: number): Extract<Block, { kind: "user" }> | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.kind === "user") {
      return b.meta?.entryId ? b : null;
    }
  }
  return null;
}

/** The first user message after a block (a reply is branched "from here" by forking just before it). */
export function nextAsk(blocks: readonly Block[], index: number): Extract<Block, { kind: "user" }> | null {
  for (let i = index + 1; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b.kind === "user") {
      return b.meta?.entryId ? b : null;
    }
  }
  return null;
}
