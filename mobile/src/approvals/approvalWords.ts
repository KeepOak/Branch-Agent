// Plain words for an approval. The verbs and a plugin's field rows come from the window's card
// (window/src/thread/ApprovalCard.tsx actionWords and actionFields); masking secrets, the mixed-alphabet
// warning and what Always allow covers come from its trust details (window/src/thread/approval-trust.ts,
// themselves ported from the preview's pb18 pass). Nothing here shows the engine's own wording for a rule.
import type { Answered, Approval } from './approvals';

export type Verbs = { yes: string; no: string; done: string; refused: string };

/** "Send it" and "Don’t send" for a request that sends, otherwise "Allow" and "Deny" (preview verbG18 / nopeG18). */
export function actionWords(approval: Pick<Approval, 'kind' | 'title'>): Verbs {
  return approval.kind === 'plugin' && /^send\b/i.test((approval.title ?? '').trim())
    ? { yes: 'Send it', no: 'Don’t send', done: 'Sent', refused: 'Not sent' }
    : { yes: 'Allow', no: 'Deny', done: 'Allowed', refused: 'Denied' };
}

/** A plugin's description split into rows ("To: Dana", "Subject: …") and the rest, its body. */
export function actionFields(description: string): { fields: [string, string][]; body: string } {
  const fields: [string, string][] = [];
  const rest: string[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = /^([A-Z][\w ]{0,23}):\s+(.+)$/.exec(line.trim());
    if (m && !rest.length) fields.push([m[1], m[2]]);
    else rest.push(line);
  }
  return { fields, body: rest.join('\n').trim() };
}

/** Secrets in a command show as dots (preview maskPB18). */
export function maskCommand(text: string): string {
  return text.replace(/(Bearer\s+|token=|key=|password=)[^\s"&]+/gi, '$1••••••••');
}

const LATIN = /[A-Za-z\u00C0-\u024F]/;
const LOOKALIKE = /[\u0370-\u03FF\u0400-\u04FF]/;

/** A word that mixes Latin with Cyrillic or Greek letters, which can look the same (preview mixedPB18). */
export function mixedAlphabets(text: string): boolean {
  return text.split(/[\s"'\x60/\\|&;:=()[\]{}<>,.!?*+-]+/).some((word) => LATIN.test(word) && LOOKALIKE.test(word));
}

/** What Always allow covers for this exact command (preview coversPB18). */
export function alwaysAllowCover(name: string): string {
  return `${name} may run this exact command again without asking, until you take it back on your computer.`;
}

/** The card's headline: what the Trunk wants, in its own words for a plugin, else "Run a command". */
export function headline(approval: Approval): string {
  return approval.kind === 'plugin' ? approval.title || 'Do something on your computer' : 'Run a command';
}

/** Where it would run: this computer or another one the engine named. */
export function computerName(host?: string): string {
  return !host || host === 'gateway' ? 'This computer' : host;
}

/** A folder, with the home folder shortened to ~ so the end of the path stays readable. */
export function shortFolder(cwd: string): string {
  return cwd.replace(/^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/, '~');
}

/** "Expires in 4:12", "Expires in 12 min", or null once it has gone. */
export function expiresIn(expiresAtMs: number | undefined, now: number): string | null {
  if (!expiresAtMs) return null;
  const left = Math.ceil((expiresAtMs - now) / 1000);
  if (left <= 0) return null;
  if (left >= 600) return `Expires in ${Math.round(left / 60)} min`;
  return `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function isExpired(approval: Approval, now: number): boolean {
  return Boolean(approval.expiresAtMs && approval.expiresAtMs <= now);
}

/** What an answered approval's pill says: what happened and where. */
export function outcomeWords(answered: Answered): string {
  const verbs = actionWords(answered);
  if (answered.outcome === 'expired') return 'Expired · not allowed';
  if (answered.outcome === 'gone') return 'Answered somewhere else';
  const what = answered.outcome === 'allowed' ? (answered.always ? 'Always allowed' : verbs.done) : verbs.refused;
  return answered.by === 'phone' ? `${what} on this phone` : `${what} somewhere else`;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The notification: who needs a yes, and what for, short enough for a lock screen. */
export function notificationText(approval: Approval, trunk: string): { title: string; body: string } {
  if (approval.kind === 'plugin') {
    const { fields, body } = actionFields(approval.description ?? '');
    const detail = fields.map(([k, v]) => `${k}: ${v}`).join(' · ') || body;
    return { title: `${trunk} needs a yes`, body: clip([headline(approval), detail].filter(Boolean).join('\n'), 180) };
  }
  return { title: `${trunk} needs a yes`, body: clip(`Run: ${maskCommand(approval.command).replace(/\s+/g, ' ').trim()}`, 180) };
}
