// Google Chat tests cover account-isolated message-tool discovery.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectGoogleChatAccount, resolveGoogleChatAccount } from "./accounts.js";
import { googlechatMessageActions } from "./message-tool-api.js";

const unresolvedRef = {
  source: "env",
  provider: "default",
  id: "BRANCH_TEST_MISSING_GOOGLE_CHAT_SERVICE_ACCOUNT",
} as const;

function buildTwoAccountConfig(): BranchConfig {
  return {
    channels: {
      googlechat: {
        accounts: {
          broken: { serviceAccount: unresolvedRef },
          healthy: {
            serviceAccount:
              '{"client_email":"proof@example.iam.gserviceaccount.com","private_key":"proof-key"}',
          },
        },
      },
    },
  } as BranchConfig;
}

describe("Google Chat message-tool SecretRef inspection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps healthy account actions when one account credential is unavailable", () => {
    const cfg = buildTwoAccountConfig();
    expect(googlechatMessageActions.describeMessageTool({ cfg })).toEqual({ actions: ["send"] });
    expect(googlechatMessageActions.describeMessageTool({ cfg, accountId: "broken" })).toBeNull();
  });

  it("keeps direct account resolution strict", () => {
    expect(() =>
      resolveGoogleChatAccount({ cfg: buildTwoAccountConfig(), accountId: "broken" }),
    ).toThrow(/unresolved SecretRef/);
  });

  it("does not fall through an unavailable configured ref to the environment", () => {
    vi.stubEnv(
      "GOOGLE_CHAT_SERVICE_ACCOUNT",
      '{"client_email":"fallback@example.iam.gserviceaccount.com","private_key":"fallback"}',
    );
    const account = inspectGoogleChatAccount({
      cfg: { channels: { googlechat: { serviceAccount: unresolvedRef } } } as BranchConfig,
    });
    expect(account).toMatchObject({
      credentialSource: "none",
      tokenStatus: "configured_unavailable",
    });
    expect(account.credentials).toBeUndefined();
  });
});
