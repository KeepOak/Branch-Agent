// User-visible failures are one plain sentence. Raw dumps (an exception class, a Java
// stack, an errno, a fetch failure) stay in the log.

/** Offline, DNS, or the network dropping out. */
export const CANT_REACH_BRANCH = 'Can’t reach Branch. Check your connection.';

/** A failure with no more specific words. */
export const PLAIN_FAILURE = 'That didn’t work. Try again.';

const ERROR_LEAD = /^\s*(?:uncaught\s+)?error:\s*/i;

const NETWORK =
  /java\.net|javax\.net|UnknownHostException|SocketTimeoutException|ConnectException|NoRouteToHostException|SocketException|SSLException|ProtocolException|fetch failed|Failed to fetch|NetworkError|Network request failed|socket hang up|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN|gateway (?:closed|not connected)|NetworkModule/i;

const RAW: RegExp[] = [
  NETWORK,
  /(?:^|\n)\s*at\s+\S|\bat\s+[\w$.<>]+\s+\([^)]+:\d+/,
  /\b[A-Z][A-Za-z]*(?:Error|Exception)\b/,
  /^\s*(?:Uncaught\s+)?Error\b\s*:/,
  /\bE(?:CONNREFUSED|CONNRESET|CONNABORTED|NOENT|ACCES|PERM|NOSPC|TIMEDOUT|HOSTUNREACH|NETUNREACH|NOTFOUND|AI_AGAIN)\b/,
  /\b(?:INVALID_REQUEST|NOT_FOUND|NOT_PAIRED|FORBIDDEN|UNAUTHORIZED|INTERNAL(?:_ERROR)?|ERR_[A-Z0-9_]+|[A-Z]{2,}_[A-Z0-9_]{2,})\b/,
  /\b(?:HTTP|status(?: code)?)\s*[:=]?\s*[1-5]\d{2}\b/i,
  /^\s*[{[]|\{\s*"\w+"\s*:/,
  /\.java:\d+|java\./i,
  /\bUnexpected token\b/i,
];

function matches(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  return re.test(text);
}

function logHidden(raw: string, error: unknown): void {
  console.warn('[branch] hidden failure', raw, error);
}

/** The words of a failure exactly as it came. */
export function errorWords(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error); // plain-error-allow: sanitizer maps dumps to plain words
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return error == null ? '' : String(error); // plain-error-allow: sanitizer maps dumps to plain words
}

function dumpOf(error: unknown, words: string): string {
  if (error instanceof Error) return [error.name, error.message, words].filter(Boolean).join('\n'); // plain-error-allow: sanitizer maps dumps to plain words
  return words;
}

/** True when the words still carry a dump: a class, a stack, Java, an errno, JSON. */
export function looksRaw(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed) && RAW.some((re) => matches(re, trimmed));
}

/**
 * Words a person can read. Network dumps become {@link CANT_REACH_BRANCH}. Already-plain
 * sentences pass through. Everything else becomes {@link PLAIN_FAILURE}. The raw value is logged.
 */
export function plainError(error: unknown, fallback: string = PLAIN_FAILURE): string {
  const exact = errorWords(error);
  const words = exact.replace(ERROR_LEAD, '').trim() || exact.trim();
  if (!words) return fallback;
  const dump = dumpOf(error, `${exact}\n${words}`);
  if (matches(NETWORK, dump)) {
    logHidden(exact || words, error);
    return CANT_REACH_BRANCH;
  }
  if (!looksRaw(words)) return words;
  logHidden(exact || words, error);
  return fallback;
}
