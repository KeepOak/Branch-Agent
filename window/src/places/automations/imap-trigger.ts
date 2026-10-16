// The Automations email trigger writes the bundled IMAP plugin's account fields.
// Passwords stay secret references; this patch never carries them.
import { rec, str, type Row } from "./runtime";

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const MAX_FILTER = 200;

export type MailboxChoice = {
  id: string;
  label: string;
  folder: string;
  filter: string;
  agentId: string;
  allowedSenders: number;
};

export type ImapTrigger = { accountId: string; folder: string; filter: string; agentId: string };

const SECRET_SOURCES = new Set(["env", "file", "exec", "store"]);

function usesSecretReference(password: unknown): boolean {
  if (!password || typeof password !== "object" || Array.isArray(password)) return false;
  const ref = rec(password);
  return SECRET_SOURCES.has(str(ref.source)) && str(ref.provider).trim().length > 0 && str(ref.id).trim().length > 0;
}

/** Mailboxes whose password is already a secret reference. The password is never copied out. */
export function connectedMailboxes(snapshot: unknown): MailboxChoice[] {
  const root = rec(snapshot);
  const config = root.plugins ? root : rec(root.config);
  const accounts = rec(rec(rec(rec(config.plugins).entries).imap).config).accounts;
  const choices: MailboxChoice[] = [];
  for (const [id, raw] of Object.entries(rec(accounts))) {
    if (!ACCOUNT_ID.test(id)) continue;
    const account = rec(raw);
    const label = str(account.user).trim();
    if (!label || !str(account.host).trim() || !usesSecretReference(account.password)) continue;
    const senders = Array.isArray(account.allowedSenders) ? account.allowedSenders.filter(item => str(item).trim()) : [];
    choices.push({
      id,
      label,
      folder: str(account.mailbox).trim() || "INBOX",
      filter: str(account.match).trim(),
      agentId: str(account.agentId).trim(),
      allowedSenders: senders.length,
    });
  }
  return choices.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) <= 0x1f) return true;
  }
  return false;
}

function plain(value: string, empty: string): string {
  const text = value.trim();
  if (!text) throw new Error(empty);
  if (hasControl(text)) throw new Error("Use plain text.");
  return text;
}

/** The trigger card's fields. Throws the words the card shows. */
export function validateImapTrigger(input: { accountId: string; folder: string; filter: string; agentId: string }, mailboxes: readonly { id: string }[]): ImapTrigger {
  const accountId = input.accountId.trim();
  if (!mailboxes.some(box => box.id === accountId)) throw new Error("Choose a mailbox that is already connected.");
  const folder = plain(input.folder, "Choose a folder.");
  const filter = input.filter.trim();
  if (hasControl(filter)) throw new Error("Use plain text.");
  if (filter.length > MAX_FILTER) throw new Error("Use a shorter filter.");
  const agentId = plain(input.agentId, "Choose who does it.");
  return { accountId, folder, filter, agentId };
}

/** config.patch for one connected mailbox. Host, user and password are left untouched. */
export function imapTriggerPatch(trigger: ImapTrigger): Row {
  return {
    plugins: {
      entries: {
        imap: {
          enabled: true,
          config: { accounts: { [trigger.accountId]: { mailbox: trigger.folder, match: trigger.filter, agentId: trigger.agentId } } },
        },
      },
    },
  };
}

export function triggerSummary(box: Pick<MailboxChoice, "folder" | "filter">): string {
  const folder = box.folder || "INBOX";
  if (!box.filter.trim()) return `Folder ${folder}. Every new email that this mailbox already allows.`;
  return `Folder ${folder}. Only when the sender or subject contains “${box.filter.trim()}”.`;
}
