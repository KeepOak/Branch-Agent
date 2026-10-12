// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/pii_redaction_middleware.py (atlas SAFETY-0062)
import { createHmac } from "node:crypto";
import type { FilterPiiCategory } from "../filters.js";

/** A fixed detector with an optional checksum gate for numeric identifiers. */
export interface IdentifierDetector {
  readonly id: string;
  readonly label: string;
  readonly pattern: RegExp;
  readonly category: FilterPiiCategory;
  readonly validate?: (value: string) => boolean;
}

function digitsOf(value: string): number[] {
  return [...value].filter((ch) => ch >= "0" && ch <= "9").map(Number);
}

/** Luhn checksum over the digits of the value (separators ignored). */
export function luhnValid(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  let checksum = 0;
  digits.reverse().forEach((original, offset) => {
    let digit = original;
    if (offset % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    checksum += digit;
  });
  return checksum % 10 === 0;
}

const CN_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
const CN_ID_CHECK_DIGITS = "10X98765432";

/** GB 11643 checksum for the 18-digit resident ID number. */
export function cnResidentIdValid(value: string): boolean {
  const body = value.slice(0, 17);
  if (!/^\d{17}$/.test(body)) {
    return false;
  }
  const year = Number(body.slice(6, 10));
  const month = Number(body.slice(10, 12));
  const day = Number(body.slice(12, 14));
  if (!(year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) {
    return false;
  }
  let total = 0;
  CN_ID_WEIGHTS.forEach((weight, index) => {
    total += Number(body[index]) * weight;
  });
  return CN_ID_CHECK_DIGITS[total % 11] === (value[17] ?? "").toUpperCase();
}

/** Brazilian CPF mod-11 verification digits. */
export function cpfValid(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 11 || new Set(digits).size === 1) {
    return false;
  }
  for (const boundary of [9, 10]) {
    let weight = 2;
    let total = 0;
    for (const digit of digits.slice(0, boundary).reverse()) {
      total += digit * weight;
      weight += 1;
    }
    const rest = ((total * 10) % 11) % 10;
    if (rest !== digits[boundary]) {
      return false;
    }
  }
  return true;
}

/** Dispatch by shape: CN resident ID, CPF; CUIT/RFC are format-only. */
export function nationalIdValid(value: string): boolean {
  if (value.includes(".") || (value.length === 18 && /^\d{17}/.test(value))) {
    return value.includes(".") ? cpfValid(value) : cnResidentIdValid(value);
  }
  return true;
}

function phoneDigitsValid(value: string): boolean {
  const count = digitsOf(value).length;
  return count >= 8 && count <= 15;
}

/**
 * Order is load-bearing: checksum-gated national IDs precede the credit-card
 * detector so an 18-digit resident ID that also passes Luhn is never labelled a
 * card, and phones see only digits the stronger gates did not claim.
 * Digit-anchored patterns use digit-aware lookarounds instead of \b.
 */
export const IDENTIFIER_DETECTORS: readonly IdentifierDetector[] = [
  {
    id: "email",
    label: "email address",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
    category: "email",
  },
  {
    id: "api_key",
    label: "API key",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/,
    category: "credential",
  },
  {
    id: "national_id",
    label: "national ID",
    pattern:
      /(?<![\dXx])\d{17}[\dXx](?![\dXx])|(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)|(?<!\d)\d{2}-\d{8}-\d(?!\d)|(?<![A-Z0-9Ñ&])[A-ZÑ&]{4}\d{6}[0-9A-Z]{3}(?![A-Z0-9Ñ&])/,
    category: "national_id",
    validate: nationalIdValid,
  },
  {
    id: "credit_card",
    label: "credit card number",
    pattern: /(?<!\d)(?:\d{4}[ -]){3}\d{1,7}(?!\d)|(?<!\d)\d{13,19}(?!\d)/,
    category: "credit_card",
    validate: luhnValid,
  },
  {
    id: "phone",
    label: "phone number",
    pattern:
      /(?<!\d)\+\d{1,3}(?:[ -]?\d{1,4}){3,6}(?!\d)|(?<!\d)1[3-9]\d{9}(?!\d)|\(\d{3}\) ?\d{3}[-.]?\d{4}(?!\d)/,
    category: "phone",
    validate: phoneDigitsValid,
  },
];

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const TOKEN_LETTERS = 27;

/**
 * Value-derived, deterministic placeholder: a 128-bit HMAC digest of the value
 * under the deployment secret, encoded over a-z so a minted token never holds
 * digit runs a later detector could re-match. No mapping table is stored.
 */
export function placeholderToken(category: string, value: string, tokenKey: string): string {
  if (!tokenKey) {
    throw new Error("placeholder tokens require the configured non-empty tokenSecret");
  }
  const digest = createHmac("sha256", Buffer.from(tokenKey, "utf8"))
    .update(`${category}\u0000${value}`, "utf8")
    .digest();
  let number = BigInt(`0x${digest.subarray(0, 16).toString("hex")}`);
  const letters: string[] = [];
  for (let index = 0; index < TOKEN_LETTERS; index++) {
    letters.push(TOKEN_ALPHABET[Number(number % 26n)] ?? "a");
    number /= 26n;
  }
  return `[${category.toUpperCase()}_${letters.join("")}]`;
}
