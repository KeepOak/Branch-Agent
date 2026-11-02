const MAX_MATCH_LENGTH = 200;

/** The optional sender or subject filter stored on an IMAP account. Blank means no extra text filter. */
export function readImapMatchFilter(value: unknown, accountId: string): string {
  if (value == null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`IMAP account ${accountId} filter must be text`);
  }
  const match = value.trim();
  if (match.length > MAX_MATCH_LENGTH) {
    throw new Error(`IMAP account ${accountId} filter is too long`);
  }
  return match;
}

/**
 * True when the filter is blank, or the sender text or the subject contains it.
 * Matching is case-insensitive and does not look at the message body.
 */
export function imapMessageMatchesFilter(
  filter: string | undefined,
  sender: string,
  subject: string,
): boolean {
  const needle = (filter ?? "").trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return sender.toLowerCase().includes(needle) || subject.toLowerCase().includes(needle);
}
