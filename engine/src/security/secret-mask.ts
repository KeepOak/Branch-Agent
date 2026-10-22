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
const TOKEN_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}/g;

/** Masks an email address, keeping only its first character. */
export function maskEmail(email: string): string {
  const first = sliceUtf16Safe(email, 0, 1);
  return `${first}${SECRET_MASK}@${SECRET_MASK}`;
}

/** Replaces email addresses and raw `sk-` style tokens found anywhere in free text. */
export function redactIdentifiersInText(text: string): string {
  return text
    .replace(EMAIL_PATTERN, (match) => maskEmail(match))
    .replace(TOKEN_PATTERN, (match) => maskApiKey(match));
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
