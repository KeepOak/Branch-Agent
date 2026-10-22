import { describe, expect, it } from "vitest";
import { maskApiKey, maskEmail, redactIdentifiersInText, SECRET_MASK } from "./secret-mask.js";

describe("maskApiKey", () => {
  it.each([
    ["   ", "missing"],
    [" short ", SECRET_MASK],
    [" a ", SECRET_MASK],
    ["abcdefghijk", SECRET_MASK],
    [" abcdefghijklmnop ", `${SECRET_MASK}mnop`],
    ["1234567890abcdefghijklmnop", `${SECRET_MASK}mnop`],
  ])("masks %o", (value, expected) => {
    expect(maskApiKey(value)).toBe(expected);
  });

  it("never reveals a prefix or more than 4 trailing characters", () => {
    const masked = maskApiKey(["sk-ant-", "oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789wxyz"].join("")); // pragma: allowlist secret
    expect(masked).toBe(`${SECRET_MASK}wxyz`);
    expect(masked).not.toContain("sk-");
  });

  it("strips control characters before applying the display policy", () => {
    expect(maskApiKey("abcd\nefghijklmnop")).toBe(`${SECRET_MASK}mnop`);
    expect(maskApiKey("abcd\u0000efghijklmnop")).toBe(`${SECRET_MASK}mnop`);
    expect(maskApiKey("abcd\u007f\u0085efghijklmnop")).toBe(`${SECRET_MASK}mnop`);
    expect(maskApiKey("\u0000\n")).toBe("missing");
  });

  it("does not split UTF-16 surrogate pairs at the suffix boundary", () => {
    expect(maskApiKey("😀")).toBe(SECRET_MASK);
    const masked = maskApiKey("abcdefghijklmn😀😀");
    expect(() => encodeURIComponent(masked)).not.toThrow();
    expect(masked).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(masked).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe("maskEmail / redactIdentifiersInText", () => {
  it("masks emails and raw sk- tokens in free text", () => {
    expect(maskEmail("jane.doe@example.com")).toBe(`j${SECRET_MASK}@${SECRET_MASK}`);
    const out = redactIdentifiersInText(
      ["anthropic:jane.doe@example.com=OAuth (jane.doe@example.com) key sk-", "proj-ABCDEFGHIJKL1234"].join(""),
    );
    expect(out).not.toContain("example.com");
    expect(out).not.toContain("sk-proj");
    expect(out).toContain(`${SECRET_MASK}1234`);
  });

  it.each([
    ["Google OAuth", ["ya29.", "a0AfH6SMBxFAKEfakeFAKEfake567890abcd1234"].join("")], // pragma: allowlist secret
    ["Google API key", ["AIza", "SyFAKEfakeFAKEfakeFAKEfakeFAKE01234"].join("")], // pragma: allowlist secret
    ["GitHub classic", ["ghp_", "FAKEfakeFAKEfakeFAKEfakeFAKEfake1234"].join("")], // pragma: allowlist secret
    ["GitHub OAuth", "gho_FAKEfakeFAKEfakeFAKEfakeFAKEfake1234"], // pragma: allowlist secret
    ["GitHub fine-grained", "github_pat_11FAKEFAKE0fakefakefake_FAKEfakeFAKE1234"], // pragma: allowlist secret
    ["Slack bot", ["xoxb-", "1234567890-FAKEfakeFAKE-1234"].join("")], // pragma: allowlist secret
    ["Slack user", ["xoxp-", "1234567890-FAKEfakeFAKE-1234"].join("")], // pragma: allowlist secret
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.FAKEfakeFAKEfakeSig1234", // pragma: allowlist secret
    ],
    ["AWS access key", "AKIAFAKEFAKEFAKE1234"], // pragma: allowlist secret
  ])("masks a %s token in free text", (_name, token) => {
    const out = redactIdentifiersInText(`provider failed with ${token} (retrying)`);
    expect(out).not.toContain(token);
    expect(out).not.toContain(token.slice(0, 8));
    expect(out).toBe(`provider failed with ${SECRET_MASK}1234 (retrying)`);
  });

  it("masks bearer tokens but keeps the scheme word", () => {
    const out = redactIdentifiersInText(
      "Authorization: Bearer FAKEfakeFAKEfake.opaque-1234", // pragma: allowlist secret
    );
    expect(out).toBe(`Authorization: Bearer ${SECRET_MASK}1234`);
  });

  it.each([
    ["api_key=", "FAKEfakeFAKEfakeFAKEfakeFAKEfake1234"], // pragma: allowlist secret
    ['token: "', "0123456789abcdef0123456789abcdef1234"], // pragma: allowlist secret
    ["client secret ", "RkFLRWZha2VGQUtFZmFrZUZBS0VmYWtl+/1234=="], // pragma: allowlist secret
  ])("masks long labelled secrets after %o", (label, value) => {
    const out = redactIdentifiersInText(`${label}${value}`);
    expect(out).not.toContain(value);
    expect(out.startsWith(label)).toBe(true);
    expect(out).toContain(SECRET_MASK);
  });

  it("leaves normal status lines unchanged", () => {
    const lines = [
      "Default model: anthropic/claude-sonnet-4-5-20250929",
      "openai/gpt-5.1-codex-max (context 400k) ready",
      "google/gemini-2.5-pro-preview-06-05 via OAuth",
      "build 05f07ae3dbb602ab5ebc0d3f3342dc98bded9828 on main",
      "sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "Auth: Bearer token configured (env OPENAI_API_KEY)",
      "token usage: 12,345 input / 6,789 output",
      "key: openai-codex profile default",
      "skill-runner ok; task-scheduler ok; desk-agent ok",
    ];
    for (const line of lines) {
      expect(redactIdentifiersInText(line)).toBe(line);
    }
  });
});
