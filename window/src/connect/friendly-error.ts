// One place that turns an engine or unknown failure into copy a stranger can read.
// The user-facing wrapper in the engine's embedded-agent-helpers/error-text.ts keeps classified
// sentences and replaces a raw passthrough (the dump unchanged, JSON, HTTP, an Error: prefix).
// Already-plain copy is returned unchanged. Only a raw or technical dump becomes the generic next step.

/** One sentence and a next step. Used when the value is empty or still looks like a dump. */
export const FRIENDLY_ERROR = "Something went wrong. Retry.";

const ERROR_PREFIX_RE =
  /^(?:(?:[a-z][\w-]*\s+)?(?:api\s*)?error|[A-Z][A-Za-z]*Error)(?:\s*\(\d{3}\)|\s+\d{3})?\s*[:\-]\s*/i;
const STACK_RE = /\n\s*at\s+\S|:\d+:\d+\b/;
const JSON_RE = /^\s*[{[]|[{[][^\n]*"(?:error|type|message|code)"\s*:/;
const STATUS_RE = /\bHTTP\s*[1-5]\d{2}\b|\bstatus(?:\s+code)?\s*[:=]?\s*[1-5]\d{2}\b|\b[1-5]\d{2}\s+(?:Internal|Bad|Unauthorized|Forbidden|Not\s+Found|OK|Error|Gateway|Service|Moved|Found|Unavailable)\b/i;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const HEX_ID_RE = /\b[0-9a-f]{16,}\b/i;
const NAMED_ID_RE = /\b(?:request[\s_-]*id|runId|sessionKey|agentId|gatewayCode)\b/i;
const SESSION_KEY_RE = /\b[a-z][a-z0-9_-]{1,20}:[a-z0-9_-]+:[a-z0-9_-]+/i;
const METHOD_RE = /\b[a-z]{3,}\.[a-z][a-zA-Z0-9]{2,}\b/;
const ERRNO_RE = /\bE[A-Z]{3,}\b/;
const CLASS_ERROR_RE = /\b[A-Z][A-Za-z]+Error\b/;
const CODE_RE = /\b[A-Z][A-Z0-9_]{5,}\b/;
const QUOTED_STATUS_RE = /the engine answered\s+"/i;

function extractRaw(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return value.message.trim();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["message", "error", "summary", "reason"] as const) {
      const text = rec[key];
      if (typeof text === "string" && text.trim()) return text.trim();
    }
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** True when the text still looks like an engine or provider dump, so it must not be shown. */
function looksRaw(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return (
    STACK_RE.test(trimmed) ||
    JSON_RE.test(trimmed) ||
    ERROR_PREFIX_RE.test(trimmed) ||
    CLASS_ERROR_RE.test(trimmed) ||
    STATUS_RE.test(trimmed) ||
    UUID_RE.test(trimmed) ||
    HEX_ID_RE.test(trimmed) ||
    NAMED_ID_RE.test(trimmed) ||
    SESSION_KEY_RE.test(trimmed) ||
    METHOD_RE.test(trimmed) ||
    ERRNO_RE.test(trimmed) ||
    CODE_RE.test(trimmed) ||
    QUOTED_STATUS_RE.test(trimmed)
  );
}

function stripErrorPrefixes(text: string): string {
  let current = text;
  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(ERROR_PREFIX_RE, "").trim();
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Already-plain copy, unchanged. A raw dump becomes one sentence with a next step. */
export function friendlyError(value: unknown): string {
  const raw = extractRaw(value);
  if (!raw) return FRIENDLY_ERROR;
  const stripped = stripErrorPrefixes(raw);
  if (!stripped || looksRaw(stripped)) return FRIENDLY_ERROR;
  // One-word states such as "Disconnected" stay as they are. A one-word dump (a code, a number, "error") does not.
  if (!/\s/.test(stripped)) {
    if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/.test(stripped)) return stripped;
    return FRIENDLY_ERROR;
  }
  return stripped;
}
