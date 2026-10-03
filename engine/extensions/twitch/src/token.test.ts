import { afterEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../api.js";
import { resolveTwitchToken } from "./token.js";

describe("token", () => {
  const originalAccessToken = process.env.BRANCH_TWITCH_ACCESS_TOKEN;

  // Simplified single-account config
  const mockSimplifiedConfig = {
    channels: {
      twitch: {
        username: "testbot",
        accessToken: "oauth:config-token",
      },
    },
  } as unknown as BranchConfig;

  afterEach(() => {
    if (originalAccessToken === undefined) {
      delete process.env.BRANCH_TWITCH_ACCESS_TOKEN;
    } else {
      process.env.BRANCH_TWITCH_ACCESS_TOKEN = originalAccessToken;
    }
  });

  describe("resolveTwitchToken", () => {
    it("should prioritize config token over env var (simplified config)", () => {
      process.env.BRANCH_TWITCH_ACCESS_TOKEN = "oauth:env-token";

      const result = resolveTwitchToken(mockSimplifiedConfig, { accountId: "default" });

      // Config token should be used even if env var exists
      expect(result.token).toBe("oauth:config-token");
      expect(result.source).toBe("config");
    });

    it("should use env var when config token is empty (simplified config)", () => {
      process.env.BRANCH_TWITCH_ACCESS_TOKEN = "oauth:env-token";

      const configWithEmptyToken = {
        channels: {
          twitch: {
            username: "testbot",
            accessToken: "",
          },
        },
      } as unknown as BranchConfig;

      const result = resolveTwitchToken(configWithEmptyToken, { accountId: "default" });

      expect(result.token).toBe("oauth:env-token");
      expect(result.source).toBe("env");
    });

    it("should return empty token when neither config nor env has token (simplified config)", () => {
      const configWithoutToken = {
        channels: {
          twitch: {
            username: "testbot",
            accessToken: "",
          },
        },
      } as unknown as BranchConfig;

      const result = resolveTwitchToken(configWithoutToken, { accountId: "default" });

      expect(result.token).toBe("");
      expect(result.source).toBe("none");
    });

    it("should not use env var for non-default accounts (multi-account)", () => {
      process.env.BRANCH_TWITCH_ACCESS_TOKEN = "oauth:env-token";

      const configWithoutToken = {
        channels: {
          twitch: {
            accounts: {
              secondary: {
                username: "secondary",
                accessToken: "",
              },
            },
          },
        },
      } as unknown as BranchConfig;

      const result = resolveTwitchToken(configWithoutToken, { accountId: "secondary" });

      // Non-default accounts shouldn't use env var
      expect(result.token).toBe("");
      expect(result.source).toBe("none");
    });

    it("should handle missing account gracefully", () => {
      const configWithoutAccount = {
        channels: {
          twitch: {
            accounts: {},
          },
        },
      } as unknown as BranchConfig;

      const result = resolveTwitchToken(configWithoutAccount, { accountId: "nonexistent" });

      expect(result.token).toBe("");
      expect(result.source).toBe("none");
    });

    it("should handle missing Twitch config section", () => {
      const configWithoutSection = {
        channels: {},
      } as unknown as BranchConfig;

      const result = resolveTwitchToken(configWithoutSection, { accountId: "default" });

      expect(result.token).toBe("");
      expect(result.source).toBe("none");
    });
  });
});
