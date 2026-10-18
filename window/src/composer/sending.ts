// What Send does with the draft (DESIGN-SPEC §4.3.1 Interactions and "Sending while it works").
import { toChatAttachments, type DraftFile } from "./attachments";
import type { SendExtras } from "./engine";
import { commandWord } from "./slash";
import type { Person } from "./DockRow";
import { mentionsIn } from "./useDraft";

export type SendPlan =
  | { kind: "nothing" }
  | { kind: "stop" }
  | { kind: "background"; text: string }
  | { kind: "command"; text: string }
  | { kind: "send"; queueMode?: "steer" | "interrupt" }
  | { kind: "wait" };

/**
 * `queueMode` is the session's effectiveQueueMode (steer, followup, collect or interrupt). While the Trunk works,
 * Enter does what it says and Ctrl Enter (`alt`) does the other one; "interrupt" has no second action.
 */
export function planSend(text: string, hasFiles: boolean, working: boolean, queueMode: string, alt: boolean): SendPlan {
  const t = text.trim();
  if (!t && !hasFiles) return { kind: "nothing" };
  const word = commandWord(t);
  if (word === "stop") return { kind: "stop" };
  if (word === "bg") return { kind: "background", text: t.replace(/^\/bg\s*/i, "") };
  if (t.startsWith("/")) return { kind: "command", text: t };
  if (!working) return { kind: "send" };
  if (queueMode === "interrupt") return { kind: "send", queueMode: "interrupt" };
  const steerFirst = queueMode === "steer" || queueMode === "";
  return steerFirst !== alt ? { kind: "send", queueMode: "steer" } : { kind: "wait" };
}

/** The Send button's tooltip while it works with a draft: both actions, in the order Enter and Ctrl Enter do them. */
export function sendTooltip(queueMode: string): string {
  if (queueMode === "interrupt") return "Send";
  return queueMode === "steer" || queueMode === "" ? "Enter: steer it now · Ctrl Enter: wait in line" : "Enter: wait in line · Ctrl Enter: steer it now";
}

/** Words to keep on screen the moment Send is pressed in an empty conversation (preview send()). */
export function firstSendEcho(text: string): string | null {
  const t = text.trim();
  return t || null;
}

/** Keep that local echo until the engine's history holds the message, or the send failed for good. */
export function shouldKeepFirstSendEcho(historyHasMessage: boolean, sendFailed: boolean): boolean {
  return !historyHasMessage && !sendFailed;
}

export type Reply = { entryId: string; name: string; text: string };

export function buildExtras(text: string, files: readonly DraftFile[], people: readonly Person[], queueMode?: string, reply?: Reply | null): SendExtras & { replyToId?: string } {
  const attachments = toChatAttachments(files);
  const mentions = mentionsIn(text, people);
  return {
    ...(attachments.length ? { attachments } : {}),
    ...(mentions.length ? { mentions } : {}),
    ...(queueMode ? { queueMode } : {}),
    ...(reply ? { replyToId: reply.entryId } : {}),
  };
}
