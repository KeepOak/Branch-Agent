// No raw engine error at Regular (Private #1089). A failure's words reach a person through plainError(): at Regular,
// words that issue 1700's friendlyError() would replace (a dump, JSON, an HTTP status, an id, a code, a method name), or that
// carry a stack, an error class or errno code (CodexNotInstalledError, ECONNREFUSED), a file path or an engine sentence
// such as `unknown method: logbook.status`, read as one plain sentence with one next step chosen from the map below,
// and any web or computer address reads as plainAddresses() (#1706) says. Words that are already plain pass through
// unchanged, with the lead a screen put before the raw part (`Couldn't change Lockdown: …`). Advanced and Technical keep
// the exact words.
//
// plainText() is for words that are not always a failure (a toast like "Copied.", a banner title, the line above the
// page). friendlyError() reads a one-word or numbered line as raw, so those use the strong markers only, which include
// issue 1700's id shapes (a UUID, a long hex id, a named id, a session key with or without `agent:`).
import { FRIENDLY_ERROR, friendlyError } from "../connect/friendly-error";
import { plainAddresses } from "./plain-address";

/** The "How much to show" level's saved choice (places-nav/SettingsFrame readLevel), read as plainAddresses() reads it. */
function atRegular(): boolean {
  try {
    const level = localStorage.getItem("branch.level");
    return level !== "advanced" && level !== "technical";
  } catch {
    return true;
  }
}

/** The sentence for a failure nothing more specific matches. */
export const PLAIN_FAILURE = "That didn’t work. Try again.";

/** The engine's Gateway lock is held (handoff, a busy state database). Never the class name, even at Advanced. */
export const LOCK_BUSY = "Branch is busy right now. Try again in a moment.";

const LOCK_BUSY_RE =
  /\bGatewayLockError\b|\bGatewayStateOwnerContentionError\b|\bstate database is busy\b|\bfailed to acquire gateway state ownership\b/i;

/** True when the words are the engine's Gateway lock, not a person-facing failure. */
export function isLockBusyMessage(text: string): boolean {
  return LOCK_BUSY_RE.test(text);
}

/** Error classes, codes and engine sentences, each with the plain sentence a person reads instead. First match wins. */
const SAYS: [RegExp, string][] = [
  [LOCK_BUSY_RE, LOCK_BUSY],
  [/\bunknown method\b|\bmethod not found\b/i, "This part of Branch isn’t ready on this computer yet. Update Branch, then try again."],
  [/\bunknown agent id\b|\bagent not found\b|\bno such agent\b/i, "That Trunk isn’t on this computer. Choose another Trunk."],
  [/\bNo API key found\b|\bno (?:model|provider) (?:is )?(?:connected|configured|set)\b|\bmodel_not_found\b|\bno auth profile\b|\bMissing(?:ApiKey|Credentials)\b/i, "No model is connected. Connect one in Settings, Models, then try again."],
  [/\bE(?:CONNREFUSED|CONNRESET|CONNABORTED|HOSTUNREACH|NETUNREACH|NOTFOUND|AI_AGAIN|PIPE)\b|\bgateway (?:closed|not connected)\b|\bsocket hang up\b|\bfetch failed\b|\bFailed to fetch\b|\bNetworkError\b/i, "Branch can’t reach its engine right now. It keeps trying, so try again in a moment."],
  [/\bENOSPC\b|\bno space left\b|\bQuotaExceededError\b/i, "This computer is out of space. Free some space, then try again."],
  [/\bENOENT\b|\bno such file or directory\b|\bENOTDIR\b/i, "That file or folder isn’t there. Check that it still exists, then try again."],
  [/\bE(?:ACCES|PERM|ROFS)\b|\bpermission denied\b|\boperation not permitted\b/i, "Branch isn’t allowed to do that here. Check the folder’s permissions, then try again."],
  [/NotInstalled|\bnot installed\b|\bcommand not found\b|\bnpm ERR!|\bE404\b/i, "That isn’t installed on this computer. Install it, then try again."],
  [/\b(?:HTTP\s*|status(?: code)?\s*[:=]?\s*)?(?:401|403)\b|\bunauthori[sz]ed\b|\bforbidden\b|\binvalid api key\b|\btoken (?:mismatch|expired)\b/i, "Branch isn’t signed in for that. Sign in again, then try again."],
  [/\b429\b|\brate.?limit|\btoo many requests\b/i, "That service is busy. Wait a minute, then try again."],
  [/\bE?TIMEDOUT\b|\btimed out\b|\btimeout\b/i, "That took too long. Try again."],
];

const RAW: RegExp[] = [
  /\n\s*at\s+\S|\bat\s+[\w$.<>]+\s+\([^)]*:\d+:\d+\)/, // a stack
  /\b[A-Z][A-Za-z]*(?:Error|Exception)\b/, // an error class
  /^\s*(?:Uncaught\s+)?Error\b\s*:/,
  /\bE(?:CONNREFUSED|CONNRESET|CONNABORTED|NOENT|ACCES|PERM|NOSPC|EXIST|ISDIR|NOTDIR|NOTEMPTY|MFILE|PIPE|TIMEDOUT|HOSTUNREACH|NETUNREACH|NOTFOUND|AI_AGAIN|ADDRINUSE|ADDRNOTAVAIL|BUSY|ROFS|NOTSUP|INVAL|404)\b/, // an errno code
  /\b(?:INVALID_REQUEST|UNAVAILABLE|NOT_FOUND|NOT_PAIRED|FORBIDDEN|UNAUTHORIZED|INTERNAL(?:_ERROR)?|ERR_[A-Z0-9_]+|[A-Z]{2,}_[A-Z0-9_]{2,})\b/, // a gateway or library code
  /\bunknown (?:method|agent id)\b|\bmethod not found\b/i, // an engine refusal in its own words
  /\b(?:sessions|chat|agents|config|models|plugins|skills|cron|memory|logbook|doctor|exec|node|tts|rooms|contacts|users|usage|backup|browser|computer|system|update|gateway|channels|canopy|projects|themes|wizard|portal|branch)\.[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)*\b/, // an engine method name
  /(?:^|[\s\x27\x22(=:])(?:~|\/(?:home|Users|root|opt|var|tmp|usr|etc|private|mnt|workspace|app|srv|snap|run|Library|Applications|Volumes))\/\S*/, // a file path
  /\b[A-Za-z]:\\[^\s]*/, // a Windows path
  /^\s*[{[]|\{\s*"\w+"\s*:/, // JSON
  /\b(?:HTTP|status(?: code)?)\s*[:=]?\s*[1-5]\d{2}\b/i, // an HTTP status
  /\bgateway (?:closed|not connected)\b/i, // a socket close
  /\bCannot read propert|\bis not a function\b|\bis not defined\b|\bUnexpected token\b|\bnpm ERR!|\bfetch failed\b|\bFailed to fetch\b|\bsocket hang up\b|\bNo API key found\b/i,
  /\bagent:[\w-]+:[\w:.-]+/, // a session key
  // PR 1700 id shapes (connect/friendly-error.ts), so words that skip friendlyError() still never show an id.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // a UUID
  /\b[0-9a-f]{16,}\b/i, // a long hex id
  /\b(?:request[\s_-]*id|runId|sessionKey|agentId|gatewayCode)\b/i, // a named id
  /\b[a-z][a-z0-9_-]{1,20}:[a-z0-9_-]+:[a-z0-9_-]+/i, // a session key without agent:
];

/** True when any words (a failure or not) still carry a strong raw marker: a stack, a class or code, a path, an id. */
export function looksRaw(text: string): boolean {
  return RAW.some((re) => re.test(text));
}

/** True when a failure's words are raw: issue 1700's friendlyError() would replace them, or they carry a strong marker. */
export function looksRawError(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed) && (looksRaw(trimmed) || friendlyError(trimmed) === FRIENDLY_ERROR);
}

function sentenceFor(raw: string): string {
  for (const [re, say] of SAYS) if (re.test(raw)) return say;
  return PLAIN_FAILURE;
}

/** The words of a failure exactly as it came: an Error's message, a { message } record's, or the value itself. */
export function errorWords(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return String(error ?? "");
}

function plainWords(text: string, raw: (words: string) => boolean): string {
  const trimmed = text.trim();
  // Plain words keep their spacing: a status line can be built from parts ("Branch ", version, " keeps running.").
  if (!raw(trimmed)) return plainAddresses(text, true);
  // A plain sentence that ends with the raw words in brackets keeps the sentence: "… full. (QuotaExceededError: …)".
  const bracket = /^(.*?[.!?])\s*\(([^]*)\)\.?$/.exec(trimmed);
  if (bracket && !raw(bracket[1])) return plainAddresses(bracket[1], true);
  // A screen's own lead before the raw part keeps its words: "Couldn't change Lockdown: <raw>".
  const colon = trimmed.indexOf(": ");
  if (colon > 0) {
    const lead = trimmed.slice(0, colon).trim();
    if (lead && !looksRaw(lead) && /^[\p{Lu}\p{N}]/u.test(lead)) {
      const say = sentenceFor(trimmed.slice(colon + 2));
      return /\s/.test(lead) ? `${plainAddresses(lead, true).replace(/[.!?]*$/, ".")} ${say}` : `${lead}: ${say}`;
    }
  }
  return sentenceFor(trimmed);
}

/** A leading `Error:` (any case, with the spaces after it) is how a thrown message prints, not the failure's words. */
const ERROR_LEAD = /^\s*error:\s*/i;

/** A failure as a person reads it: at Regular one plain sentence and a next step, at Advanced and Technical the exact
 *  words. A Gateway lock is always LOCK_BUSY (never the class name). `always` skips the level check (tests, and
 *  callers that know). */
export function plainError(error: unknown, always = false): string {
  const exact = errorWords(error);
  const words = exact.replace(ERROR_LEAD, "") || exact;
  if (isLockBusyMessage(words)) return LOCK_BUSY;
  if (!words || (!always && !atRegular())) return words;
  return plainWords(words, looksRawError);
}

/** Words that may or may not be a failure (a toast, a banner, the line above the page): at Regular only words with a
 *  strong raw marker are replaced, so "Copied." or "Restarting…" stay as they are. A Gateway lock is always LOCK_BUSY. */
export function plainText(text: string, always = false): string {
  if (!text) return text;
  if (isLockBusyMessage(text)) return LOCK_BUSY;
  if (!always && !atRegular()) return text;
  return plainWords(text, looksRaw);
}
