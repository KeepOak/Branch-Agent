// Behaviour test for atlas MODELS-ACCOUNTS-0061 (credential selection receipt).
// Upstream CherryHQ/cherry-studio@e2f53146eb6944718b091661df0854c75a4d933a:src/main/ai/provider/credential.ts
// has no tests; this proves the existing Branch receipt: each reply's usage contract
// records which credential path served it, and never carries the credential itself.
import { describe, expect, it } from "vitest";
import { buildUsageContract } from "./contract.js";

describe("usage contract credential receipt", () => {
  it("records the credential path the reply ran under", () => {
    for (const authMode of ["api-key", "oauth", "token", "aws-sdk"]) {
      const contract = buildUsageContract({ provider: "anthropic", model: "claude", authMode });
      expect(contract.model.auth_mode).toBe(authMode);
    }
  });

  it("reports an unknown credential path as null instead of guessing", () => {
    const contract = buildUsageContract({ provider: "openai", model: "gpt" });
    expect(contract.model.auth_mode).toBeNull();
  });

  it("keeps secrets out of the receipt", () => {
    const secret = "not-a-real-credential-0061";
    const state = { provider: "openai", model: "gpt", authMode: "api-key", apiKey: secret };
    const contract = buildUsageContract(state);
    expect(JSON.stringify(contract)).not.toContain(secret);
    expect(contract.model.auth_mode).toBe("api-key");
  });
});
