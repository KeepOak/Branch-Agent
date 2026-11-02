// A failed free model download says what went wrong in one plain line, read from the engine's real error.
// The engine's error names files, hosts and HTTP codes, so only the kind of failure is shown, never the raw text.

/** First words of every download failure line. */
export const FREE_MODEL_DOWNLOAD_FAILED = "The free model didn’t download.";
/** The engine's managed setup failed, but its error matches none of the known reasons below. */
export const FREE_MODEL_SETUP_STOPPED = "Setting up the free model stopped before it finished.";

export const FREE_MODEL_FAILURE_REASONS = {
  disk: "This computer ran out of disk space.",
  permission: "Branch wasn’t allowed to save it on this computer.",
  integrity: "The downloaded file didn’t match what was expected, so Branch didn’t use it.",
  refused: "The download server turned the request down.",
  missing: "The download server doesn’t have the file right now.",
  server: "The download server had a problem. Try again in a few minutes.",
  timeout: "It took too long and stopped.",
  offline: "Branch couldn’t reach the download server. Check your internet connection.",
} as const;

type Reason = keyof typeof FREE_MODEL_FAILURE_REASONS;

// Most specific first: a full disk can also abort a download, and a 404 is also an HTTP failure.
const PATTERNS: ReadonlyArray<readonly [Reason, RegExp]> = [
  ["disk", /\bENOSPC\b|no space left|not enough (?:free )?(?:disk )?space|disk (?:is )?full/i],
  [
    "permission",
    /\bE(?:ACCES|PERM|ROFS)\b|permission denied|operation not permitted|read-only file system/i,
  ],
  [
    "integrity",
    /SHA-?256 mismatch|size mismatch|changed during integrity|did not (?:provide|publish) a SHA-256/i,
  ],
  ["refused", /\bHTTP (?:401|403)\b/i],
  ["missing", /\bHTTP (?:404|410)\b|did not return a GGUF/i],
  ["server", /\bHTTP (?:429|5\d\d)\b/i],
  ["timeout", /\bETIMEDOUT\b|timed? ?out\b|\btimeout\b/i],
  [
    "offline",
    /fetch failed|\bE(?:NOTFOUND|AI_AGAIN|CONNRESET|CONNREFUSED|NETUNREACH|HOSTUNREACH)\b|socket hang up|network/i,
  ],
];

const MANAGED_SETUP_FAILED = /Managed llama\.cpp setup failed/i;

/** One plain line for a failed free model download, or undefined when the error isn't one. */
export function plainFreeModelFailure(message: string): string | undefined {
  for (const [reason, pattern] of PATTERNS) {
    if (pattern.test(message))
      return FREE_MODEL_DOWNLOAD_FAILED + " " + FREE_MODEL_FAILURE_REASONS[reason];
  }
  return MANAGED_SETUP_FAILED.test(message) ? FREE_MODEL_SETUP_STOPPED : undefined;
}
