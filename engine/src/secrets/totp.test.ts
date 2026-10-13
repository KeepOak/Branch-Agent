// Copied from Skyvern-AI/skyvern@4a3ca3abccf831250f81b01f741b571564249bc4:tests/unit/test_parse_totp_secret.py (atlas INTEGRATIONS-0064)
// pyotp is the reference upstream; here an inline RFC 6238 reference plays
// that role, and the RFC 6238 appendix B vectors pin the algorithm itself.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeBase32Secret,
  generateTotpCode,
  normalizeTotpConfig,
  parseTotpConfig,
  parseTotpSecret,
  waitForFreshTotpWindow,
} from "./totp.js";

const SEED = "JBSWY3DPEHPK3PXP";

function referenceTotp(
  secret: string,
  forTime: number,
  algorithm: "sha1" | "sha256" | "sha512",
  digits: number,
  period: number,
): string {
  const key = decodeBase32Secret(secret);
  if (!key) {
    throw new Error("reference needs a valid seed");
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(forTime / period)));
  const mac = createHmac(algorithm, key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function base32(ascii: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of Buffer.from(ascii)) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let out = "";
  for (let index = 0; index < bits.length; index += 5) {
    out += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return out;
}

describe("parseTotpSecret", () => {
  it("empty string returns empty", () => {
    expect(parseTotpSecret("")).toBe("");
  });

  it("an invalid secret is discarded", () => {
    expect(parseTotpSecret("WXYZ-not-a-base32-seed-0189")).toBe("");
  });

  it("valid base32 secret", () => {
    expect(parseTotpSecret(SEED)).toBe(SEED);
  });

  it("valid base32 with dashes", () => {
    expect(parseTotpSecret("JBSW-Y3DP-EHPK-3PXP")).toBe(SEED);
  });

  it("valid base32 with whitespace", () => {
    expect(parseTotpSecret("JBSWY3DP EHPK3PXP")).toBe(SEED);
  });

  it("valid otpauth uri", () => {
    const uri = `otpauth://totp/user@example.com?secret=${SEED}&issuer=Example`;
    expect(parseTotpSecret(uri)).toBe(SEED);
  });

  it("regex extraction valid secret", () => {
    expect(parseTotpSecret(`https://example.com?secret=${SEED}&other=stuff`)).toBe(SEED);
  });

  it("invalid base32 returns empty", () => {
    expect(parseTotpSecret("not-a-valid-base32!!!")).toBe("");
  });

  it("invalid base32 short returns empty", () => {
    expect(parseTotpSecret("invalid!")).toBe("");
  });

  it("regex extraction invalid secret returns empty", () => {
    expect(parseTotpSecret("https://example.com?secret=invalid!")).toBe("");
  });
});

describe("otpauth URI configuration", () => {
  const sha256Uri = `otpauth://totp/Example:user@example.com?secret=${SEED}&issuer=Example&algorithm=SHA256&digits=8&period=60`;

  it("normalize totp config preserves otpauth uri params", () => {
    expect(normalizeTotpConfig(sha256Uri)).toBe(sha256Uri);
  });

  it("generate totp code uses otpauth uri params", () => {
    expect(generateTotpCode(sha256Uri, 0)).toBe(referenceTotp(SEED, 0, "sha256", 8, 60));
    expect(generateTotpCode(sha256Uri, 0)).toHaveLength(8);
  });

  it("otpauth uri with mismatched issuer preserves generation config", () => {
    const uri = `otpauth://totp/LabelIssuer:user@example.test?secret=${SEED}&issuer=QueryIssuer&algorithm=SHA256&digits=8&period=60`;
    expect(parseTotpSecret(uri)).toBe(SEED);
    expect(normalizeTotpConfig(uri)).toBe(uri);
    expect(generateTotpCode(uri, 0)).toBe(referenceTotp(SEED, 0, "sha256", 8, 60));
  });

  it("url encoded otpauth uri with mismatched issuer is accepted", () => {
    const uri = `otpauth://totp/LabelIssuer:user@example.test?secret=${SEED}&issuer=QueryIssuer&algorithm=SHA512&digits=7&period=45`;
    const encodedUri = encodeURIComponent(uri);
    expect(parseTotpSecret(encodedUri)).toBe(SEED);
    expect(normalizeTotpConfig(encodedUri)).toBe(uri);
    expect(generateTotpCode(encodedUri, 0)).toBe(referenceTotp(SEED, 0, "sha512", 7, 45));
  });

  it.each([
    "issuer=QueryIssuer",
    `secret=${SEED}A&issuer=QueryIssuer`,
    `secret=${SEED}&issuer=QueryIssuer&algorithm=NOPE`,
    `secret=${SEED}&issuer=QueryIssuer&digits=9`,
    `secret=${SEED}&issuer=QueryIssuer&period=invalid`,
    `secret=${SEED}&issuer=QueryIssuer&period=0`,
    `secret=${SEED}&issuer=QueryIssuer&period=-30`,
    `secret=${SEED}&issuer=QueryIssuer&unknown=value`,
    `secret=${SEED}&issuer=FirstIssuer&issuer=SecondIssuer`,
    `secret=${SEED}&issuer=QueryIssuer&issuer=QueryIssuer`,
    `secret=${SEED}&issuer=QueryIssuer&iss%75er=QueryIssuer`,
  ])("issuer mismatch does not bypass invalid config: %s", (query) => {
    const uri = `otpauth://totp/LabelIssuer:user@example.test?${query}`;
    expect(parseTotpSecret(uri)).toBe("");
    expect(normalizeTotpConfig(uri)).toBe("");
  });

  it.each(["0", "-30"])("matching issuer uri rejects nonpositive period %s", (period) => {
    const uri = `otpauth://totp/Example:user@example.test?secret=${SEED}&issuer=Example&period=${period}`;
    expect(parseTotpSecret(uri)).toBe("");
    expect(normalizeTotpConfig(uri)).toBe("");
  });

  it.each(["issuer", "iss%75er"])(
    "matching issuer uri rejects duplicate issuer %s",
    (secondKey) => {
      const uri = `otpauth://totp/Example:user@example.test?secret=${SEED}&issuer=Example&${secondKey}=Example`;
      expect(parseTotpSecret(uri)).toBe("");
      expect(normalizeTotpConfig(uri)).toBe("");
    },
  );

  it("hotp uri is not coerced into totp", () => {
    const uri = `otpauth://hotp/Example:user@example.test?secret=${SEED}&issuer=Example&counter=0`;
    expect(parseTotpSecret(uri)).toBe("");
    expect(normalizeTotpConfig(uri)).toBe("");
  });

  it.each(["otpauth://[", encodeURIComponent("otpauth://[")])(
    "malformed otpauth authority is rejected without raising: %s",
    (value) => {
      expect(parseTotpSecret(value)).toBe("");
      expect(parseTotpConfig(value)).toBeNull();
      expect(normalizeTotpConfig(value)).toBe("");
    },
  );

  it("normalize totp config preserves url encoded otpauth uri", () => {
    expect(normalizeTotpConfig(encodeURIComponent(sha256Uri))).toBe(sha256Uri);
  });

  it("otpauth uri with unsupported algorithm returns empty", () => {
    const uri = `otpauth://totp/user@example.com?secret=${SEED}&algorithm=NOPE&digits=8&period=45`;
    expect(parseTotpSecret(uri)).toBe("");
    expect(normalizeTotpConfig(uri)).toBe("");
    expect(parseTotpSecret(encodeURIComponent(uri))).toBe("");
    expect(normalizeTotpConfig(encodeURIComponent(uri))).toBe("");
  });
});

describe("generateTotpCode", () => {
  // RFC 6238 appendix B: 8-digit codes for the ASCII seeds of each algorithm.
  const sha1Seed = base32("12345678901234567890");
  const sha256Seed = base32("12345678901234567890123456789012");
  const sha512Seed = base32("1234567890123456789012345678901234567890123456789012345678901234");

  it.each([
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1234567890, "89005924", "91819424", "93441116"],
    [20000000000, "65353130", "77737706", "47863826"],
  ])("matches the RFC 6238 vectors at %s", (time, sha1, sha256, sha512) => {
    const uri = (seed: string, algorithm: string) =>
      `otpauth://totp/rfc?secret=${seed}&algorithm=${algorithm}&digits=8&period=30`;
    expect(generateTotpCode(uri(sha1Seed, "SHA1"), time)).toBe(sha1);
    expect(generateTotpCode(uri(sha256Seed, "SHA256"), time)).toBe(sha256);
    expect(generateTotpCode(uri(sha512Seed, "SHA512"), time)).toBe(sha512);
  });

  it("defaults a raw seed to six SHA-1 digits over 30 seconds", () => {
    expect(generateTotpCode(SEED, 59)).toBe(referenceTotp(SEED, 59, "sha1", 6, 30));
  });

  it("rejects an invalid seed without echoing it", () => {
    expect(() => generateTotpCode("WXYZ-not-a-base32-seed-0189", 0)).toThrow(
      "Invalid TOTP secret or otpauth URI",
    );
  });
});

describe("waitForFreshTotpWindow", () => {
  it("a late wake from the window wait waits again for a fresh window", async () => {
    const clock = { now: 28.5 };
    const lateBy = [13.5, 0];
    await waitForFreshTotpWindow(SEED, {
      minRemainingSeconds: 20,
      now: () => clock.now,
      sleep: async (seconds) => {
        clock.now += seconds + (lateBy.shift() ?? 0);
      },
    });
    expect(30 - (clock.now % 30)).toBeGreaterThanOrEqual(20);
  });
});
