// Removes secrets and personal identifiers from diagnostic text before it leaves the machine.
const SECRET_FIELD = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie)["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const QUOTED_AFTER_KEY = /\b((?:password|passwd|secret|token|api[_-]?key)\s+)(["'])[^"'\n]+\2/gi;
const LONG_HEX = /\b[a-f0-9]{40,}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Returns the text with secrets and email addresses replaced. Keeps everything else as written. */
export function redactDiagnosticText(text: string): string {
  // The auth scheme runs first so the key pattern cannot take the word "Bearer" as the secret.
  return text
    .replace(AUTH_SCHEME, "$1 [redacted]")
    .replace(SECRET_FIELD, (_match, prefix: string) => `${prefix}[redacted]`)
    .replace(QUOTED_AFTER_KEY, "$1[redacted]")
    .replace(KNOWN_TOKEN, "[redacted]")
    .replace(LONG_HEX, "[redacted]")
    .replace(EMAIL, "[email]");
}
