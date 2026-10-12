// Branch-original shared safety piece (atlas SAFETY-0196): content never grants authority.
// Forwarded, quoted, copied, exported, persona-written and engine-written text is data. It never changes who
// is speaking or what is allowed (G-1642, G-1721, G-1740, G-1741).

/** Where a piece of text came from. Only "typed" is the current sender's own words. */
export type TextProvenance =
  | "typed"
  | "forwarded"
  | "quoted"
  | "copied-history"
  | "exported-log"
  | "persona"
  | "engine-nudge"
  | "event";

export type ForwardFacts = Readonly<{
  ForwardedFrom?: string;
  ForwardedFromId?: string;
  ForwardedFromType?: string;
  ForwardedDate?: number;
}>;

/**
 * G-1642: a forwarded message's body is someone else's words. The sender stays the person who forwarded it,
 * and its text is never read as a slash command or an approval reply.
 */
export function isForwardedContent(ctx: ForwardFacts): boolean {
  return Boolean(
    ctx.ForwardedFrom?.trim() ||
      ctx.ForwardedFromId?.trim() ||
      ctx.ForwardedFromType?.trim() ||
      ctx.ForwardedDate !== undefined,
  );
}

/** G-1642: only the sender's own typed text can be a slash command or an approval reply. */
export function mayActAsCommand(provenance: TextProvenance): boolean {
  return provenance === "typed";
}

/** G-1740: engine nudges are never shown or learned as the owner's words. */
export function isOwnerWords(params: { provenance: TextProvenance; senderIsOwner: boolean }): boolean {
  return params.provenance === "typed" && params.senderIsOwner;
}

export type HistoryEntry = Readonly<{
  id: string;
  kind: "message" | "tool-call" | "approval-request" | "approval-decision" | "pending-run";
  approvalId?: string;
  text?: string;
}>;

export type InertHistoryEntry = Readonly<{
  id: string;
  kind: "message" | "record";
  text?: string;
  inert: true;
}>;

/** G-1721: copied or branched history is a record. Nothing in it runs, resumes or approves again. */
export function makeHistoryInert(entries: readonly HistoryEntry[]): InertHistoryEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind === "message" ? "message" : "record",
    ...(entry.text !== undefined ? { text: entry.text } : {}),
    inert: true,
  }));
}

/** G-1721: an approval resolves along exactly one path; a copy or a second route cannot resolve it again. */
export class ApprovalResolutionLedger {
  private readonly resolved = new Map<string, string>();

  resolve(approvalId: string, path: string): { ok: true } | { ok: false; resolvedOn: string } {
    const existing = this.resolved.get(approvalId);
    if (existing !== undefined) {
      return { ok: false, resolvedOn: existing };
    }
    this.resolved.set(approvalId, path);
    return { ok: true };
  }
}

export type PlaybackStep = Readonly<{ kind: "show"; entry: HistoryEntry }>;

/** G-1741: playback of an exported event log only shows; it executes nothing and restores no approvals. */
export function planEventLogPlayback(entries: readonly HistoryEntry[]): PlaybackStep[] {
  return entries.map((entry) => ({ kind: "show", entry }));
}

/**
 * G-1741: an explicit restart from an exported log runs with the recorded permissions intersected with today's,
 * and only after App lock is re-checked right before it starts.
 */
export function planExplicitRestart(params: {
  recordedPermissions: readonly string[];
  currentPermissions: readonly string[];
  isAppLocked: () => boolean;
}): { ok: true; permissions: string[] } | { ok: false; reason: "app-locked" } {
  if (params.isAppLocked()) {
    return { ok: false, reason: "app-locked" };
  }
  const current = new Set(params.currentPermissions);
  return { ok: true, permissions: params.recordedPermissions.filter((item) => current.has(item)) };
}
