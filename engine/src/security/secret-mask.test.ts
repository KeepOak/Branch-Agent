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
    const masked = maskApiKey("sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789wxyz"); // pragma: allowlist secret
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
      "anthropic:jane.doe@example.com=OAuth (jane.doe@example.com) key sk-proj-ABCDEFGHIJKL1234",
    );
    expect(out).not.toContain("example.com");
    expect(out).not.toContain("sk-proj");
    expect(out).toContain(`${SECRET_MASK}1234`);
  });
});
