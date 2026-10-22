import { sliceUtf16Safe } from "@branch/normalization-core/utf16-slice";

export const SECRET_MASK = "\u2022\u2022\u2022\u2022";

/**
 * Masks credential-like values for display.
 * Never reveals a prefix; reveals at most the last 4 characters, and only when the
 * value is long enough (>= 12) that the suffix cannot meaningfully narrow it down.
 */
export function maskApiKey(value: string): string {
  const trimmed = stripControlCharacters(value).trim();
  if (!trimmed) {
    return "missing";
  }
  if (trimmed.length < 12) {
    return SECRET_MASK;
  }
  return `${SECRET_MASK}${sliceUtf16Safe(trimmed, -4)}`;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/**
 * Well-known credential shapes. Each needs a vendor prefix plus a long body, so model ids,
 * commit SHAs, and other ordinary status text do not match.
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bya29\.[A-Za-z0-9_-]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgh[po]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

/** `Bearer <token>`: keeps the scheme word, masks the credential. */
const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{16,}=*)/gi;

/**
 * Long base64 or hex runs (32+ chars) that sit right after a key, token, or secret label,
 * such as `api_key=...`, `token: "..."`, or `client secret ...`. Unlabelled runs are left
 * alone so SHAs and hashes in normal output stay readable.
 */
const LABELED_SECRET_PATTERN =
  /\b([A-Za-z0-9_-]*(?:key|token|secret)s?["']?\s*(?:[:=]|\s)\s*["']?)([A-Za-z0-9+/_-]{32,}={0,2})(?![A-Za-z0-9+/_=-])/gi;

/** Masks an email address, keeping only its first character. */
export function maskEmail(email: string): string {
  const first = sliceUtf16Safe(email, 0, 1);
  return `${first}${SECRET_MASK}@${SECRET_MASK}`;
}

/**
 * Replaces email addresses and credential-shaped tokens (vendor-prefixed keys, JWTs,
 * bearer tokens, and long labelled secrets) found anywhere in free text.
 */
export function redactIdentifiersInText(text: string): string {
  let result = text.replace(EMAIL_PATTERN, (match) => maskEmail(match));
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, (match) => maskApiKey(match));
  }
  return result
    .replace(BEARER_PATTERN, (_match, scheme: string, token: string) => `${scheme}${maskApiKey(token)}`)
    .replace(
      LABELED_SECRET_PATTERN,
      (_match, label: string, value: string) => `${label}${maskApiKey(value)}`,
    );
}

function stripControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isControl = (code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
    if (!isControl) {
      result += character;
    }
  }
  return result;
}
