// Behaviour tests for atlas SAFETY-0200 (G-1684): email sender identity needs an aligned pass.
import { describe, expect, it } from "vitest";
import { resolveEmailSenderIdentity } from "./email-sender-identity.js";

const trusted = ["mx.branch.example"];

describe("G-1684 email sender identity", () => {
  it("G-1684: an aligned DMARC, DKIM or SPF pass in the first trusted header makes an identity", () => {
    for (const [result, via] of [
      ["dmarc=pass header.from=example.com", "dmarc"],
      ["dkim=pass header.d=mail.example.com", "dkim"],
      ["spf=pass smtp.mailfrom=bounce@example.com", "spf"],
    ] as const) {
      expect(
        resolveEmailSenderIdentity({
          from: "Owner@Example.com",
          authenticationResults: [`mx.branch.example; ${result}`],
          trustedAuthservIds: trusted,
        }),
      ).toEqual({ kind: "identity", address: "owner@example.com", via });
    }
  });

  it("G-1684: an unaligned DKIM pass is a stranger", () => {
    expect(
      resolveEmailSenderIdentity({
        from: "owner@example.com",
        authenticationResults: ["mx.branch.example; dkim=pass header.d=attacker.example; dmarc=fail header.from=example.com"],
        trustedAuthservIds: trusted,
      }),
    ).toEqual({ kind: "stranger", reason: "not-aligned" });
    expect(
      resolveEmailSenderIdentity({
        from: "owner@example.co.uk",
        authenticationResults: ["mx.branch.example; dkim=pass header.d=attacker.co.uk"],
        trustedAuthservIds: trusted,
      }).kind,
    ).toBe("stranger");
  });

  it("G-1684: only the first trusted Authentication-Results header counts", () => {
    expect(
      resolveEmailSenderIdentity({
        from: "owner@example.com",
        authenticationResults: [
          "evil.example; dmarc=pass header.from=example.com",
          "mx.branch.example; dmarc=fail header.from=example.com",
          "mx.branch.example; dmarc=pass header.from=example.com",
        ],
        trustedAuthservIds: trusted,
      }),
    ).toEqual({ kind: "stranger", reason: "not-aligned" });
    expect(
      resolveEmailSenderIdentity({
        from: "owner@example.com",
        authenticationResults: ["evil.example; dmarc=pass header.from=example.com"],
        trustedAuthservIds: trusted,
      }),
    ).toEqual({ kind: "stranger", reason: "no-trusted-results" });
  });
});
