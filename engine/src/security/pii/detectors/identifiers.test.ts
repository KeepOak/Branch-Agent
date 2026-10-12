// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_pii_redaction_middleware.py (atlas SAFETY-0062)
import { describe, expect, it } from "vitest";
import { filtersConfigSchema } from "../filters.js";
import { createPiiTextTransformer } from "../transform.js";
import type { TextContentFragment } from "../types.js";
import { IDENTIFIER_DETECTORS } from "./identifiers.js";

const TOKEN_SECRET = "unit-test-deployment-secret-0123456789";

const PII_CONFIG = {
  action: "redact" as const,
  starterPatterns: ["email", "api_key", "national_id", "credit_card", "phone"],
};

function fragment(text: string): TextContentFragment {
  return {
    id: "tool-call.arguments",
    text,
    path: "/arguments/text",
    source: "tool_argument",
    field: "arguments",
    format: "plain",
    treatment: "replaceable",
    provenance: "user",
  };
}

function redactText(text: string, tokenSecret = TOKEN_SECRET): string {
  return createPiiTextTransformer(PII_CONFIG, { tokenSecret })
    .createSession()
    .transform(fragment(text)).content;
}

const EMAIL_ALICE = redactText("alice@example.com");
const EMAIL_BOB_COM = redactText("bob@example.com");
const EMAIL_BOB_ORG = redactText("bob@example.org");
const PHONE_INTL = redactText("+86 138 0013 8000");
const PHONE_CN = redactText("13800138000");
const PHONE_US = redactText("(212) 555-0123");
const PHONE_US2 = redactText("+1 415 555 2671");
const KEY_SK = redactText("sk-proj4aaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const KEY_AWS = redactText("AKIAIOSFODNN7EXAMPLE");
const CARD_VISA = redactText("4111 1111 1111 1111");
const ID_X = redactText("11010519491231002X");
const ID_L150 = redactText("110105194912310150");
const ID_W239 = redactText("110105197506150239");
const ID_CUIT = redactText("20-12345678-6");
const ID_CPF = redactText("529.982.247-25");

describe("TestDetectors", () => {
  it("test_pinned_detector_count", () => {
    expect(IDENTIFIER_DETECTORS).toHaveLength(5);
    expect(IDENTIFIER_DETECTORS.map((detector) => detector.id)).toEqual([
      "email",
      "api_key",
      "national_id",
      "credit_card",
      "phone",
    ]);
  });

  it("test_cn_resident_id_with_luhn_valid_digits_not_mislabeled_as_card", () => {
    expect(redactText("id 110105194912310150")).toContain(`id ${ID_L150}`);
    expect(ID_L150).toMatch(/^\[NATIONAL_ID_[a-z]+\]$/);
  });

  it("test_email_redacted", () => {
    const email = IDENTIFIER_DETECTORS[0];
    const result = "ping me at alice@example.com today".replace(
      new RegExp(email?.pattern.source ?? "", "g"),
      "X",
    );
    expect(result).toBe("ping me at X today");
  });

  it("test_distinct_emails_get_distinct_placeholders", () => {
    expect(redactText("from alice@example.com to bob@example.org")).toContain(
      `from ${EMAIL_ALICE} to ${EMAIL_BOB_ORG}`,
    );
    expect(EMAIL_ALICE).not.toBe(EMAIL_BOB_ORG);
  });

  it("test_same_email_shares_placeholder", () => {
    expect(redactText("alice@example.com here")).toBe(`${EMAIL_ALICE} here`);
    expect(redactText("reply to alice@example.com")).toBe(`reply to ${EMAIL_ALICE}`);
  });

  it("test_openai_style_api_key_redacted", () => {
    expect(redactText("key: sk-proj4aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toContain(KEY_SK);
  });

  it("test_aws_access_key_redacted", () => {
    expect(redactText("use AKIAIOSFODNN7EXAMPLE please")).toContain(KEY_AWS);
  });

  it("test_credit_card_luhn_valid_redacted", () => {
    expect(redactText("card 4111 1111 1111 1111 on file")).toContain(`card ${CARD_VISA} on file`);
  });

  it("test_credit_card_luhn_invalid_untouched", () => {
    const original = "card 1234 5678 9012 3456 on file";
    expect(redactText(original)).toBe(original);
  });

  it("test_long_digit_run_non_card_untouched", () => {
    const original = "order 1234567890123 shipped";
    expect(redactText(original)).toBe(original);
  });

  it("test_international_phone_redacted", () => {
    expect(redactText("call +86 138 0013 8000 now")).toContain(`call ${PHONE_INTL} now`);
  });

  it("test_cn_mobile_redacted", () => {
    expect(redactText("phone 13800138000")).toContain(`phone ${PHONE_CN}`);
  });

  it("test_us_phone_redacted", () => {
    expect(redactText("dial (212) 555-0123")).toContain(`dial ${PHONE_US}`);
  });

  it("test_cn_resident_id_valid_redacted", () => {
    expect(redactText("id 11010519491231002X")).toContain(`id ${ID_X}`);
  });

  it("test_cn_resident_id_invalid_checksum_untouched", () => {
    const original = "id 110105194912310020";
    expect(redactText(original)).toBe(original);
  });

  it("test_willem_vector_numeric_check_digit_redacted", () => {
    expect(redactText("id 110105197506150239")).toContain(`id ${ID_W239}`);
    expect(ID_W239).toMatch(/^\[NATIONAL_ID_[a-z]+\]$/);
  });

  it("test_cuit_valid_form_redacted", () => {
    expect(redactText("CUIT 20-12345678-6")).toContain(`CUIT ${ID_CUIT}`);
  });

  it("test_cuit_wrong_digit_count_untouched", () => {
    const original = "CUIT 20-1234567890-6";
    expect(redactText(original)).toBe(original);
  });

  it("test_cjk_adjacent_identifiers_redacted", () => {
    const content = redactText(
      "身份证11010519491231002X 手机号13800138000 信用卡4111 1111 1111 1111",
    );
    expect(content).toContain(ID_X);
    expect(content).toContain(PHONE_CN);
    expect(content).toContain(CARD_VISA);
    expect(content).not.toContain("11010519491231002X");
    expect(content).not.toContain("13800138000");
    expect(content).not.toContain("4111");
  });

  it("test_international_phone_does_not_consume_next_line", () => {
    expect(redactText("Call +1 415 555 2671\n20260918")).toBe(`Call ${PHONE_US2}\n20260918`);
  });

  it("test_cpf_valid_redacted", () => {
    expect(redactText("cpf 529.982.247-25")).toContain(`cpf ${ID_CPF}`);
  });

  it("test_cpf_invalid_untouched", () => {
    const original = "cpf 529.982.247-11";
    expect(redactText(original)).toBe(original);
  });
});

describe("keyed placeholder tokens", () => {
  it("test_existing_placeholder_text_passes_through_and_new_value_gets_token", () => {
    expect(redactText("Alice [EMAIL_1], Bob bob@example.com")).toBe(
      `Alice [EMAIL_1], Bob ${EMAIL_BOB_COM}`,
    );
  });

  it("test_minted_tokens_survive_later_detectors", () => {
    const result = redactText("contact user280@example.com today");
    expect(result.startsWith("contact [EMAIL_")).toBe(true);
    expect(result.endsWith("] today")).toBe(true);
    expect(result.split("[")).toHaveLength(2);
    expect(result.split("]")).toHaveLength(2);
    expect(result).not.toContain("@");
    expect(result).not.toContain("user280");
  });

  it("test_token_secret_scopes_linkability", () => {
    const secretA = "deployment-a-secret-value";
    const secretB = "deployment-b-secret-value";
    expect(redactText("alice@example.com", secretA)).not.toBe(
      redactText("alice@example.com", secretB),
    );
    expect(redactText("alice@example.com", secretA)).toBe(redactText("alice@example.com", secretA));
  });

  it("test_hmac_tokens_still_letters_only", () => {
    const result = redactText("contact user280@example.com today", "s3cret-with-enough-length");
    expect(result.split("[")).toHaveLength(2);
    expect(result.split("]")).toHaveLength(2);
    expect(result).not.toContain("@");
    expect(result).not.toContain("user280");
    expect(result).toMatch(/\[EMAIL_[a-z]{27}\]/);
  });

  it("test_enabled_config_rejects_missing_or_weak_token_secret", () => {
    expect(filtersConfigSchema.safeParse({ tokenSecret: "   " }).success).toBe(false);
    expect(filtersConfigSchema.safeParse({ tokenSecret: "short" }).success).toBe(false);
    expect(filtersConfigSchema.safeParse({ tokenSecret: TOKEN_SECRET }).success).toBe(true);
  });
});
