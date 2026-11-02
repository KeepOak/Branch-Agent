// A failed free model download says what went wrong in one plain line, read from the engine's real error.
// The engine's error names files, hosts and HTTP codes, so only the kind of failure is shown, never the raw text.

/** First words of every download failure line. */
export const FREE_MODEL_DOWNLOAD_FAILED = "Download failed:";
/** The engine's managed setup failed, but its error matches none of the known reasons below. */
export const FREE_MODEL_SETUP_STOPPED = "Free model setup stopped before it finished.";

export const FREE_MODEL_FAILURE_REASONS = {
  disk: "this computer is out of disk space.",
  permission: "Branch couldn’t save the file on this computer.",
  integrity: "the file didn’t check out, so Branch didn’t use it.",
  refused: "the download server turned the request down.",
  missing: "the download server doesn’t have the file right now.",
  server: "the download server had a problem. Try again later.",
  timeout: "it took too long and stopped.",
  offline: "Branch couldn’t reach the server. Check your internet.",
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
  // Only the managed setup wraps download errors. Any other wizard error keeps the generic line,
  // even when it mentions a network problem or a timeout.
  if (!MANAGED_SETUP_FAILED.test(message)) return undefined;
  for (const [reason, pattern] of PATTERNS) {
    if (pattern.test(message))
      return FREE_MODEL_DOWNLOAD_FAILED + " " + FREE_MODEL_FAILURE_REASONS[reason];
  }
  return FREE_MODEL_SETUP_STOPPED;
}
