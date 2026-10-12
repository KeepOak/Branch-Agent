import { describe, expect, it } from "vitest";
import { findLegacyConfigIssues } from "../../../config/legacy.js";
import type { BranchConfig } from "../../../config/types.branch.js";

export function registerLegacySilentReplyConfigMigrationTests(
  migrateLegacyConfigForTest: (raw: unknown) => {
    config: BranchConfig | null;
    changes: string[];
  },
): void {
  describe("legacy silent reply config migrate", () => {
    it.each(["allow", "disallow"] as const)(
      "detects retired internal silent replies set to %s",
      (internal) => {
        expect(
          findLegacyConfigIssues({
            agents: { defaults: { silentReply: { internal } } },
            surfaces: { telegram: { silentReply: { internal } } },
          }).map((issue) => issue.path),
        ).toEqual(["agents.defaults.silentReply", "surfaces"]);
      },
    );

    it("removes retired silent reply config and preserves channel group policy", () => {
      const res = migrateLegacyConfigForTest({
        agents: {
          defaults: {
            silentReply: { group: "allow", internal: "allow" },
          },
        },
        surfaces: {
          telegram: {
            silentReply: { group: "disallow", internal: "disallow" },
          },
        },
      });
      expect(res.config?.agents?.defaults).toEqual({
        silentReply: { group: "allow" },
      });
      expect(res.config?.surfaces?.telegram).toEqual({ silentReply: { group: "disallow" } });
      expect(findLegacyConfigIssues(res.config)).toEqual([]);
      expect(migrateLegacyConfigForTest(res.config)).toEqual({ config: null, changes: [] });
    });
  });
}
