// Home: the preview's r50 phone Home, as plain functions. Greeting and the one-line summary
// follow greetG18 / p50sHome; Allow/Deny verbs are the same as Approvals (verbG18 / nopeG18).
// Unfinished destinations are named here so the screen can show "<label> comes in a later update."
// only at Advanced and above (owner rule). Nothing here invents usage, spend, or a computer still.

import { actionFields, actionWords, computerName, headline, maskCommand, mixedAlphabets, shortFolder } from '../approvals/approvalWords';
import { trunkOf, type Approval, type Trunk } from '../approvals/approvals';
import { filterRows, type ChatRow } from '../chats/chatList';

export type AccessLevel = 'regular' | 'advanced' | 'technical';

export function isAdvanced(level: AccessLevel): boolean {
  return level === 'advanced' || level === 'technical';
}

/** Preview greetG18: evening before 5, morning before 12, afternoon before 18, else evening. */
export function greet(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Preview p50sHome sum: "N waiting for you · M working" or "Nothing waiting for you · M working". */
export function homeSummary(waiting: number, working: number): string {
  const need = waiting > 0 ? `${waiting} waiting for you` : 'Nothing waiting for you';
  return `${need} · ${working} working`;
}

export function laterUpdate(label: string): string {
  return `${label} comes in a later update.`;
}

export const LATER_HOME_ACTIONS = ['Talk', 'New Trunk', 'Scan', 'Automations', 'What’s left'] as const;
export type LaterHomeAction = (typeof LATER_HOME_ACTIONS)[number];

/** Trunk chats that are working right now. Rooms are left out, as in workingG18. */
export function workingNow(rows: ChatRow[]): ChatRow[] {
  return rows.filter((row) => row.working && !row.room && !row.archived);
}

/**
 * Recent idle chats for Finished: not working, not waiting, not archived, not snoozed, not an
 * automation. Newest first, at most three — the preview's Finished list length.
 */
export function finishedNow(rows: ChatRow[], now: number): ChatRow[] {
  return filterRows(rows, 'all', now)
    .filter((row) => !row.working && !row.needsYou && !row.room && row.preview)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
}

export type HomeNeed = {
  id: string;
  kind: Approval['kind'];
  sessionKey?: string;
  trunk: Trunk;
  title: string;
  yes: string;
  no: string;
  fields: [string, string][];
  /** Exec only: the exact command, secrets dotted out the way Approvals masks them. */
  command?: string;
  folder?: string;
  computer?: string;
  warnings: string[];
  mixed?: boolean;
};

/** Allow is only for a request the card can actually show (the command, or a plugin's own words). */
export function canAllowNeed(need: HomeNeed): boolean {
  return need.kind !== 'exec' || Boolean(need.command?.trim());
}

/** Pending approvals as Home "Needs you" cards: oldest first, at most three (p50sHome). */
export function homeNeeds(pending: Approval[], trunks: Record<string, Trunk>): HomeNeed[] {
  return pending.slice(0, 3).map((approval) => {
    const verbs = actionWords(approval);
    const { fields } = actionFields(approval.description ?? '');
    const exec = approval.kind === 'exec';
    return {
      id: approval.id,
      kind: approval.kind,
      ...(approval.sessionKey ? { sessionKey: approval.sessionKey } : {}),
      trunk: trunkOf(approval, trunks),
      title: headline(approval),
      yes: verbs.yes,
      no: verbs.no,
      fields: fields.slice(0, 2),
      ...(exec
        ? {
            command: maskCommand(approval.command).replace(/\s+/g, ' ').trim() || undefined,
            folder: approval.cwd ? shortFolder(approval.cwd) : 'Its workspace',
            computer: computerName(approval.host),
            mixed: mixedAlphabets(approval.command),
          }
        : {}),
      warnings: approval.warnings,
    };
  });
}

/**
 * What Working now can say without a live run log: the last line is the current step. One bar,
 * in progress — we do not invent "step 3 of 8".
 */
export function workingStep(row: ChatRow): { text: string; steps: Array<'done' | 'now' | 'todo'> } {
  return { text: row.preview || 'Working', steps: ['now'] };
}

export function gatewayWord(online: boolean): string {
  return online ? 'on' : 'off';
}
